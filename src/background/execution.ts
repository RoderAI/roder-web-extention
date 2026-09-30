import type {
  AgentCommand,
  BridgeSettings,
  SitePermission,
} from "../shared/protocol";
import { safeUrl } from "../shared/utils";
import * as perms from "./permissions";
import * as dbg from "./debugger";
import { content, observe, serial } from "./page";
import { inputAction } from "./input";
export type BoundCommand = {
  command: AgentCommand;
  tabId: number;
  origin: string;
  documentToken: string;
  sitePerm: SitePermission;
};
export async function bindCommand(
  command: AgentCommand,
  tabId: number,
  sitePerm: SitePermission,
): Promise<BoundCommand> {
  const tab = await chrome.tabs.get(tabId);
  const origin = perms.originOf(tab.url);
  if (!origin) throw new Error("Target has no permitted web origin");
  return {
    command: { ...command, tabId } as AgentCommand,
    tabId,
    origin,
    documentToken: (await content(tabId, { type: "ping" })).documentToken,
    sitePerm,
  };
}
function modeAllowed(command: AgentCommand, settings: BridgeSettings): boolean {
  switch (command.type) {
    case "tab/navigate":
      return settings.allowNavigation;
    case "page/highlight":
      return settings.allowPageInspection;
    case "page/eval":
      return settings.allowEval && settings.controlMode === "control";
    case "debug/attach":
      return settings.allowDebugger;
    default:
      return settings.allowInput && settings.controlMode === "control";
  }
}
export async function validateBound(
  bound: BoundCommand,
  settings: BridgeSettings,
): Promise<void> {
  if (!modeAllowed(bound.command, settings))
    throw new Error("Action is disabled by current settings");
  const tab = await chrome.tabs.get(bound.tabId);
  if (perms.originOf(tab.url) !== bound.origin)
    throw new Error("Target origin changed since the action was authorized");
  if (!(await perms.checkPermission(tab.url, bound.sitePerm)))
    throw new Error("Site permission was revoked");
  if (
    (await content(bound.tabId, { type: "ping" })).documentToken !==
    bound.documentToken
  )
    throw new Error("Target document changed since the action was authorized");
}
export async function executeBound(
  bound: BoundCommand,
  settings: () => BridgeSettings,
  signal?: AbortSignal,
): Promise<unknown> {
  return serial(bound.tabId, () => execute(bound, settings, signal));
}
async function execute(
  bound: BoundCommand,
  settings: () => BridgeSettings,
  signal?: AbortSignal,
): Promise<unknown> {
  const { command, tabId } = bound;
  const check = () => validateBound(bound, settings());
  await check();
  signal?.throwIfAborted();
  let action: unknown;
  switch (command.type) {
    case "tab/navigate": {
      const url = safeUrl(command.url);
      if (!url) throw new Error("Only http(s) navigation is allowed");
      if (!(await perms.checkPermission(url, "interact")))
        throw new Error("Navigation destination lacks interact permission");
      action = await chrome.tabs.update(tabId, { url });
      break;
    }
    case "page/highlight":
      action = await content(tabId, { ...command, type: "highlight" });
      break;
    case "page/click":
    case "page/type":
    case "page/keypress":
    case "page/scroll":
    case "page/select":
      action = await inputAction(command, tabId, check, signal);
      break;
    case "page/eval": {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: (code: string) => {
          try {
            const value = new Function(`return (${code})`)();
            return {
              ok: true,
              value:
                typeof value === "object"
                  ? JSON.parse(JSON.stringify(value))
                  : value,
            };
          } catch (error) {
            return { ok: false, error: String(error) };
          }
        },
        args: [command.expression],
      });
      if (!injection?.result?.ok)
        throw new Error(injection?.result?.error ?? "Evaluation failed");
      action = { value: injection.result.value, untrusted: true };
      break;
    }
    case "debug/attach":
      await dbg.attach(tabId);
      return { attached: tabId };
    default:
      throw new Error(`Cannot execute command: ${command.type}`);
  }
  // Observe the actual resulting document after loading/settling. Redirects must
  // independently satisfy inspection permission before any page data is returned.
  await waitForLoad(tabId);
  const tab = await chrome.tabs.get(tabId);
  if (
    !settings().allowPageInspection ||
    !(await perms.checkPermission(tab.url, "inspect"))
  )
    throw new Error("Action ran; resulting document cannot be inspected");
  return { action, observation: await observe(tabId), tabId, untrusted: true };
}
async function waitForLoad(tabId: number): Promise<void> {
  const deadline = Date.now() + 8000;
  // Give the browser a chance to start a default navigation after Input returns.
  await new Promise((resolve) => setTimeout(resolve, 100));
  while ((await chrome.tabs.get(tabId)).status === "loading") {
    if (Date.now() > deadline)
      throw new Error("Action observation exceeded navigation bound");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
