import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const runtime =
  process.env.RODER_PLAYWRIGHT_MODULE ??
  path.dirname(require.resolve("playwright-core/package.json"));
const { chromium } = require(runtime);
const { wsServer, PNG } = require(`${runtime}/lib/utilsBundle.js`);
const fixture = `<!doctype html><title>Primitive fixture</title><style>body{background:white}#region{height:100px;width:200px;overflow:auto}#inside{height:1000px}#pad{height:1300px}</style><input id="edit"><input id="readonly" readonly><input id="password" type="password" value="fake-secret"><button id="click">Click</button><button class="same">Same</button><button class="same">Same</button><select id="pick"><option value="a">A</option><option value="b">B</option><option value="c">C</option></select><form action="/submitted"><input id="search" name="q"></form><div id="region"><div id="inside">Scroll region</div></div><p id="out">Before</p><button id="increment">Increment</button><p id="count">Count: 0</p><div id="pad"></div><script>window.events=[];window.count=0;document.querySelector('#increment').onclick=()=>document.querySelector('#count').textContent='Count: '+(++window.count);for(const kind of ['click','input','keydown','keyup','mousedown','mouseup','change','wheel'])document.addEventListener(kind,e=>events.push({kind,trusted:e.isTrusted,id:e.target.id,key:e.key}));document.querySelector('#click').onclick=()=>document.querySelector('#out').textContent='After real click';</script>`;
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(
    req.url.startsWith("/other")
      ? '<title>Other tab</title><body style="background:rgb(0,255,0)">Other</body>'
      : fixture,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const ws = new wsServer({ server });
let socket;
let resolveConnected;
const connected = new Promise((resolve) => (resolveConnected = resolve));
const pending = new Map();
const activities = [];
ws.on("connection", (s) => {
  socket = s;
  s.on("message", (raw) => {
    const event = JSON.parse(raw.toString());
    if (event.type === "hello") resolveConnected();
    if (event.type === "activity") activities.push(event);
    if (event.type === "command/result") {
      pending.get(event.id)?.(event);
      pending.delete(event.id);
    }
  });
});
let seq = 0;
function send(type, params = {}) {
  const id = `eval-${++seq}`;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout ${type}`));
    }, 15000);
    pending.set(id, (event) => {
      clearTimeout(timer);
      resolve(event);
    });
  });
  socket.send(JSON.stringify({ type, id, ...params }));
  return promise;
}
async function ok(type, params = {}) {
  const result = await send(type, params);
  assert.equal(result.ok, true, result.error);
  return result.result;
}
const profile = await fs.mkdtemp(
  path.join(os.tmpdir(), "roder-extension-eval-"),
);
let context;
await fs.mkdir("output/playwright", { recursive: true });
const rows = [];
async function test(name, run) {
  await run();
  rows.push({ name, passed: true });
  console.log(`PASS ${name}`);
}
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath:
      process.env.RODER_CHROMIUM ??
      "/Users/pz/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    args: [
      `--disable-extensions-except=${path.resolve("dist")}`,
      `--load-extension=${path.resolve("dist")}`,
    ],
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 2,
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${extensionId}/options.html`);
  const msg = (command) =>
    ui.evaluate((command) => chrome.runtime.sendMessage(command), command);
  await msg({
    type: "connect",
    settings: {
      endpoint: origin.replace("http", "ws"),
      token: "fixture-only",
      controlMode: "control",
      allowInput: true,
      allowNavigation: true,
      allowPageInspection: true,
    },
  });
  await connected;
  await ok("permissions/set", {
    origin,
    perms: { inspect: true, interact: true, alwaysAllow: true },
  });
  const page = await context.newPage();
  await page.goto(origin);
  const tabs = (await ok("tabs/list")).tabs;
  const tabId = tabs.find((t) => t.url === origin + "/").id;
  await test("click is trusted and returns fresh observation", async () => {
    const r = await ok("page/click", { tabId, selector: "#click" });
    assert.match(r.observation.text, /After real click/);
    assert.equal(
      await page.evaluate(
        () =>
          events.find((e) => e.kind === "click" && e.id === "click").trusted,
      ),
      true,
    );
    assert.equal(r.untrusted, true);
  });
  await test("parallel action calls serialize through their fresh observations", async () => {
    const [first, second] = await Promise.all([
      ok("page/click", { tabId, selector: "#increment" }),
      ok("page/click", { tabId, selector: "#increment" }),
    ]);
    assert.match(first.observation.text, /Count: 1/);
    assert.match(second.observation.text, /Count: 2/);
  });
  await test("typing uses trusted browser input and replaces text", async () => {
    await ok("page/type", { tabId, selector: "#edit", text: "hello" });
    await ok("page/type", { tabId, selector: "#edit", text: "replacement" });
    assert.equal(await page.locator("#edit").inputValue(), "replacement");
    assert.equal(
      await page.evaluate(() =>
        events.filter((e) => e.kind === "input").every((e) => e.trusted),
      ),
      true,
    );
  });
  await test("Shift plus a printable key produces trusted uppercase input", async () => {
    await ok("page/type", { tabId, selector: "#edit", text: "" });
    await ok("page/keypress", { tabId, key: "Shift+a" });
    assert.equal(await page.locator("#edit").inputValue(), "A");
  });
  await test("readonly and ambiguous targets reject without click", async () => {
    const before = await page.evaluate(() => events.length);
    assert.equal(
      (await send("page/type", { tabId, selector: "#readonly", text: "wrong" }))
        .ok,
      false,
    );
    assert.equal(
      (await send("page/click", { tabId, selector: ".same" })).ok,
      false,
    );
    assert.equal(await page.evaluate(() => events.length), before);
  });
  await test("semantic DOM select verifies requested option and labels event provenance", async () => {
    const r = await ok("page/select", { tabId, selector: "#pick", value: "c" });
    assert.equal(r.action.eventsTrusted, false);
    assert.equal(await page.locator("#pick").inputValue(), "c");
  });
  await test("wheel scroll reaches the specified nested region", async () => {
    await ok("page/scroll", { tabId, selector: "#region", dy: 180 });
    assert.ok((await page.locator("#region").evaluate((e) => e.scrollTop)) > 0);
  });
  await test("references cannot be forged and expire across navigation", async () => {
    const snap = await ok("page/snapshot", { tabId });
    const ref = snap.snapshot.controls.find((c) => c.id === "click").ref;
    await page
      .locator("#edit")
      .evaluate((e, ref) => e.setAttribute("data-roder-ref", ref), ref);
    await ok("page/click", { tabId, ref });
    assert.equal(
      await page.evaluate(() => events.findLast((e) => e.kind === "click").id),
      "click",
    );
    await page.reload();
    assert.equal((await send("page/click", { tabId, ref })).ok, false);
  });
  await test("inactive tab screenshot has original CSS dimensions and masks secrets", async () => {
    const other = await context.newPage();
    await other.goto(origin + "/other");
    await other.bringToFront();
    const r = await ok("page/screenshot", { tabId });
    const png = PNG.sync.read(Buffer.from(r.dataUrl.split(",")[1], "base64"));
    assert.equal(png.width, 800);
    assert.equal(png.height, 600);
    assert.equal(png.data[1], 255);
    assert.equal(png.data[0], 255);
    const box = await page.locator("#password").boundingBox();
    const i =
      (Math.floor(box.y + box.height / 2) * png.width +
        Math.floor(box.x + box.width / 2)) *
      4;
    assert.deepEqual([...png.data.slice(i, i + 3)], [0, 0, 0]);
    await fs.writeFile(
      "output/playwright/extension-viewport.png",
      Buffer.from(r.dataUrl.split(",")[1], "base64"),
    );
    const crop = await ok("page/screenshot", {
      tabId,
      region: { x: 0, y: 0, width: 200, height: 100 },
    });
    assert.equal(
      PNG.sync.read(Buffer.from(crop.dataUrl.split(",")[1], "base64")).width,
      200,
    );
    assert.equal(
      (
        await send("page/screenshot", {
          tabId,
          region: { x: -1, y: 0, width: 10, height: 10 },
        })
      ).ok,
      false,
    );
  });
  await test("Enter uses native form submission", async () => {
    await ok("page/type", { tabId, selector: "#search", text: "query" });
    const r = await ok("page/keypress", { tabId, key: "Enter" });
    assert.match(page.url(), /submitted\?q=query/);
    assert.match(r.observation.url, /submitted/);
  });
  await test("revoked interaction permission blocks browser input", async () => {
    await ok("permissions/set", { origin, perms: { interact: false } });
    assert.equal(
      (await send("page/click", { tabId, selector: "#click" })).ok,
      false,
    );
    await ok("permissions/set", { origin, perms: { interact: true } });
  });
  await test("cancellation releases browser-applied held input before reuse", async () => {
    await worker.evaluate(() => {
      const original = chrome.debugger.sendCommand.bind(chrome.debugger);
      globalThis.__evalOriginal = original;
      globalThis.__evalDelayed = false;
      chrome.debugger.sendCommand = async (target, method, params) => {
        const result = await original(target, method, params);
        if (
          method === "Input.dispatchMouseEvent" &&
          params.type === "mousePressed" &&
          !globalThis.__evalDelayed
        ) {
          globalThis.__evalDelayed = true;
          await new Promise((r) => setTimeout(r, 2000));
        }
        return result;
      };
    });
    const before = await page.evaluate(
      () =>
        events.filter((e) => e.kind === "mouseup" && e.id === "click").length,
    );
    const cancelled = send("page/click", { tabId, selector: "#click" });
    const id = `eval-${seq}`;
    while (!(await worker.evaluate(() => globalThis.__evalDelayed)))
      await new Promise((r) => setTimeout(r, 20));
    await ok("command/cancel", { targetId: id });
    assert.equal((await cancelled).ok, false);
    assert.equal(
      await page.evaluate(
        () =>
          events.filter((e) => e.kind === "mouseup" && e.id === "click").length,
      ),
      before + 1,
    );
    await worker.evaluate(() => {
      chrome.debugger.sendCommand = globalThis.__evalOriginal;
    });
    await ok("page/click", { tabId, selector: "#click" });
    const downs = await page.evaluate(
      () => events.filter((e) => e.kind === "click" && e.id === "click").length,
    );
    assert.ok(downs >= 1);
  });
  await test("cancelled screenshot removes masks before responding", async () => {
    await worker.evaluate(() => {
      const original = chrome.debugger.sendCommand.bind(chrome.debugger);
      globalThis.__evalOriginal = original;
      globalThis.__evalDelayed = false;
      chrome.debugger.sendCommand = async (target, method, params) => {
        const result = await original(target, method, params);
        if (method === "Page.captureScreenshot" && !globalThis.__evalDelayed) {
          globalThis.__evalDelayed = true;
          await new Promise((r) => setTimeout(r, 2000));
        }
        return result;
      };
    });
    const cancelled = send("page/screenshot", { tabId });
    const id = `eval-${seq}`;
    while (!(await worker.evaluate(() => globalThis.__evalDelayed)))
      await new Promise((r) => setTimeout(r, 20));
    assert.equal(await page.locator('div[style*="2147483647"]').count(), 1);
    await ok("command/cancel", { targetId: id });
    assert.equal((await cancelled).ok, false);
    assert.equal(await page.locator('div[style*="2147483647"]').count(), 0);
    await worker.evaluate(() => {
      chrome.debugger.sendCommand = globalThis.__evalOriginal;
    });
  });
  await test("queued approval stays bound to its original document", async () => {
    await msg({ type: "updateSettings", settings: { controlMode: "assist" } });
    await ok("permissions/set", { origin, perms: { alwaysAllow: false } });
    const result = send("page/highlight", { tabId, selector: "#click" });
    while (!activities.some((a) => a.activity.status === "pending"))
      await new Promise((r) => setTimeout(r, 20));
    const activity = activities.findLast(
      (a) => a.activity.status === "pending",
    ).activity;
    await page.reload();
    await msg({ type: "approveActivity", id: activity.id });
    assert.equal((await result).ok, false);
  });
  await test("default active-tab approval keeps the originally authorized tab", async () => {
    await ok("tab/activate", { tabId });
    const count = activities.length;
    const result = send("page/highlight", { selector: "#click" });
    while (
      !activities.slice(count).some((a) => a.activity.status === "pending")
    )
      await new Promise((r) => setTimeout(r, 20));
    const activity = activities.findLast(
      (a) => a.activity.status === "pending",
    ).activity;
    const other = context.pages().find((p) => p.url().includes("/other"));
    await other.bringToFront();
    await msg({ type: "approveActivity", id: activity.id });
    const actual = await result;
    assert.equal(actual.ok, true, actual.error);
    assert.equal(actual.result.tabId, tabId);
    assert.equal(actual.result.observation.title, "Primitive fixture");
  });
  await test("permission revocation during queued approval rejects execution", async () => {
    const count = activities.length;
    const result = send("page/highlight", { tabId, selector: "#click" });
    while (
      !activities.slice(count).some((a) => a.activity.status === "pending")
    )
      await new Promise((r) => setTimeout(r, 20));
    const activity = activities.findLast(
      (a) => a.activity.status === "pending",
    ).activity;
    await ok("permissions/set", { origin, perms: { inspect: false } });
    await msg({ type: "approveActivity", id: activity.id });
    assert.equal((await result).ok, false);
    await ok("permissions/set", { origin, perms: { inspect: true } });
  });
  await test("isolated references work on ordinary insecure HTTP pages", async () => {
    await context.route("http://insecure.invalid/**", (route) =>
      route.fulfill({ contentType: "text/html", body: fixture }),
    );
    const insecure = await context.newPage();
    await insecure.goto("http://insecure.invalid/");
    assert.equal(await insecure.evaluate(() => isSecureContext), false);
    const id = (await ok("tabs/list")).tabs.find(
      (t) => t.url === "http://insecure.invalid/",
    ).id;
    const snapshot = await ok("page/snapshot", { tabId: id });
    assert.ok(snapshot.snapshot.controls.some((c) => c.id === "click"));
  });
} finally {
  await fs.writeFile(
    "output/playwright/extension-eval.json",
    JSON.stringify({ rows }, null, 2),
  );
  await context?.close();
  ws.close();
  server.close();
  await fs.rm(profile, { recursive: true, force: true });
}
