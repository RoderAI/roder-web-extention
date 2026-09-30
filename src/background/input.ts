import { content, serial } from "./page";
import { isAttached } from "./debugger";
import { keyParams } from "./input-keys";
import type { AgentCommand, BoundingBox } from "../shared/protocol";
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(signal.reason ?? new Error("Browser command cancelled"));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
class InputSession {
  masksArmed = false;
  heldKey?: Record<string, unknown>;
  heldMouse?: { x: number; y: number };
  constructor(
    readonly tabId: number,
    readonly check: () => Promise<void>,
    readonly signal?: AbortSignal,
  ) {}
  async send(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<any> {
    this.signal?.throwIfAborted();
    await this.check();
    this.signal?.throwIfAborted();
    const command = chrome.debugger.sendCommand(
      { tabId: this.tabId },
      method,
      params,
    );
    return this.signal ? abortable(command, this.signal) : command;
  }
  async click(point: { x: number; y: number }): Promise<void> {
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...point,
    });
    this.heldMouse = point;
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...point,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await chrome.debugger.sendCommand(
      { tabId: this.tabId },
      "Input.dispatchMouseEvent",
      {
        type: "mouseReleased",
        ...point,
        button: "left",
        buttons: 0,
        clickCount: 1,
      },
    );
    this.heldMouse = undefined;
  }
  async key(chord: string, commands?: string[]): Promise<void> {
    const params = keyParams(chord);
    this.heldKey = params;
    await this.send("Input.dispatchKeyEvent", {
      ...params,
      type: params.text ? "keyDown" : "rawKeyDown",
      commands,
    });
    await chrome.debugger.sendCommand(
      { tabId: this.tabId },
      "Input.dispatchKeyEvent",
      { ...params, type: "keyUp", text: undefined, modifiers: 0 },
    );
    this.heldKey = undefined;
  }
  async cleanup(): Promise<void> {
    const send = (method: string, params: Record<string, unknown>) =>
      Promise.race([
        chrome.debugger
          .sendCommand({ tabId: this.tabId }, method, params)
          .catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    if (this.heldMouse)
      await send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        ...this.heldMouse,
        button: "left",
        buttons: 0,
        clickCount: 1,
      });
    if (this.masksArmed)
      await Promise.race([
        content(this.tabId, { type: "mask", on: false }).catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    if (this.heldKey)
      await send("Input.dispatchKeyEvent", {
        ...this.heldKey,
        type: "keyUp",
        modifiers: 0,
        text: undefined,
      });
  }
}
async function withInput<T>(
  tabId: number,
  check: () => Promise<void>,
  run: (session: InputSession) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  {
    await check();
    signal?.throwIfAborted();
    const owned = !isAttached(tabId);
    if (owned) await chrome.debugger.attach({ tabId }, "1.3");
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timeout = setTimeout(
      () => controller.abort(new Error("Browser action exceeded 20 seconds")),
      20000,
    );
    const session = new InputSession(tabId, check, controller.signal);
    try {
      return await abortable(run(session), controller.signal);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      await session.cleanup();
      if (owned) await chrome.debugger.detach({ tabId }).catch(() => {});
    }
  }
}
export async function inputAction(
  command: AgentCommand,
  tabId: number,
  check: () => Promise<void>,
  signal?: AbortSignal,
): Promise<unknown> {
  if (command.type === "page/select") {
    await check();
    signal?.throwIfAborted();
    return content(tabId, {
      type: "select",
      selector: command.selector,
      value: command.value,
    });
  }
  return withInput(
    tabId,
    check,
    async (session) => {
      switch (command.type) {
        case "page/click": {
          const point = await content(tabId, { ...command, type: "probe" });
          await session.click({ x: point.x, y: point.y });
          return { ref: point.ref };
        }
        case "page/type": {
          const point = await content(tabId, {
            selector: command.selector,
            ref: command.ref,
            type: "probe",
            editing: true,
          });
          await session.click({ x: point.x, y: point.y });
          if (
            !(await content(tabId, { type: "focused", ref: point.ref })).focused
          )
            throw new Error("Editable target did not receive focus");
          await session.key("Control+a", ["selectAll"]);
          await session.send("Input.insertText", { text: command.text });
          if (command.submit) await session.key("Enter");
          return { ref: point.ref };
        }
        case "page/keypress":
          await session.key(command.key);
          return { key: command.key };
        case "page/scroll": {
          const view = await content(tabId, { type: "viewport" });
          const point = command.selector
            ? await content(tabId, {
                type: "probe",
                selector: command.selector,
              })
            : { x: view.width / 2, y: view.height / 2 };
          const deltaX = command.dx ?? 0,
            deltaY = command.dy ?? 0;
          if (
            ![deltaX, deltaY].every(Number.isFinite) ||
            Math.abs(deltaX) > 100000 ||
            Math.abs(deltaY) > 100000
          )
            throw new Error("Invalid scroll delta");
          await session.send("Input.dispatchMouseEvent", {
            type: "mouseWheel",
            x: point.x,
            y: point.y,
            deltaX,
            deltaY,
          });
          return { scrolled: true };
        }
        default:
          throw new Error(`Unsupported input command: ${command.type}`);
      }
    },
    signal,
  );
}
export async function screenshot(
  tabId: number,
  check: () => Promise<void>,
  region?: BoundingBox,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return serial(tabId, () =>
    withInput(
      tabId,
      check,
      async (session) => {
        const view = await content(tabId, { type: "viewport" });
        const box = region ?? {
          x: 0,
          y: 0,
          width: view.width,
          height: view.height,
        };
        if (
          ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
          box.x < 0 ||
          box.y < 0 ||
          box.width <= 0 ||
          box.height <= 0 ||
          box.x + box.width > view.width ||
          box.y + box.height > view.height
        )
          throw new Error("Screenshot region must be within the CSS viewport");
        try {
          session.masksArmed = true;
          await content(tabId, { type: "mask", on: true });
          const result = await session.send("Page.captureScreenshot", {
            format: "png",
            captureBeyondViewport: false,
            clip: {
              x: view.scrollX + box.x,
              y: view.scrollY + box.y,
              width: box.width,
              height: box.height,
              scale: 1,
            },
          });
          return {
            dataUrl: `data:image/png;base64,${result.data}`,
            width: box.width,
            height: box.height,
            coordinateSpace: "CSS viewport pixels",
            detail: "original",
            untrusted: true,
          };
        } finally {
          await content(tabId, { type: "mask", on: false }).catch(() => {});
          session.masksArmed = false;
        }
      },
      signal,
    ),
  );
}
