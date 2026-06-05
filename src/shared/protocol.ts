/// <reference types="chrome" />

// =============================================================================
// Roder Chrome bridge wire protocol (roder.remote.v1)
//
// This module is the single source of truth for the typed wire protocol spoken
// between the Roder app-server (gode) and this Chrome extension. `types.ts`
// re-exports everything here so existing imports keep working.
// =============================================================================

export type BridgeStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type ControlMode = 'observe' | 'assist' | 'control';

// -----------------------------------------------------------------------------
// Capabilities
// -----------------------------------------------------------------------------

export const CAPABILITIES = {
  chat: 'chat',
  tabsList: 'tabs.list',
  tabActivate: 'tab.activate',
  tabOpen: 'tab.open',
  tabClose: 'tab.close',
  tabNavigate: 'tab.navigate',
  tabsGroup: 'tabs.group',
  pageSnapshot: 'page.snapshot',
  pageScreenshot: 'page.screenshot',
  pageGetText: 'page.getText',
  pageClick: 'page.click',
  pageType: 'page.type',
  pageKeypress: 'page.keypress',
  pageScroll: 'page.scroll',
  pageSelect: 'page.select',
  pageHighlight: 'page.highlight',
  pageUpload: 'page.upload',
  pageEval: 'page.eval',
  debug: 'debug',
  recording: 'recording',
  permissions: 'permissions',
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

// -----------------------------------------------------------------------------
// Per-origin site permissions
// -----------------------------------------------------------------------------

export type SitePermission =
  | 'inspect'
  | 'interact'
  | 'eval'
  | 'debugger'
  | 'download'
  | 'upload'
  | 'recording'
  | 'schedule'
  | 'alwaysAllow';

export interface SitePermissions {
  inspect: boolean;
  interact: boolean;
  eval: boolean;
  debugger: boolean;
  download: boolean;
  upload: boolean;
  recording: boolean;
  schedule: boolean;
  alwaysAllow: boolean;
}

export const defaultSitePermissions: SitePermissions = {
  inspect: true,
  interact: false,
  eval: false,
  debugger: false,
  download: false,
  upload: false,
  recording: false,
  schedule: false,
  alwaysAllow: false,
};

export interface OriginPermissionEntry {
  origin: string;
  perms: SitePermissions;
  updatedAt: number;
}

// -----------------------------------------------------------------------------
// Bridge settings / state
// -----------------------------------------------------------------------------

export interface BridgeSettings {
  endpoint: string;
  token: string;
  autoConnect: boolean;
  controlMode: ControlMode;
  allowPageInspection: boolean;
  allowNavigation: boolean;
  allowInput: boolean;
  // New capability category toggles (global gates, combined with per-origin perms).
  allowEval: boolean;
  allowDebugger: boolean;
  allowDownload: boolean;
  allowUpload: boolean;
  allowRecording: boolean;
}

export interface BridgeState {
  status: BridgeStatus;
  endpoint: string;
  tokenPreview: string;
  controlMode: ControlMode;
  activeTab?: BrowserTabSummary;
  connectedAt?: number;
  lastError?: string;
  lastAgentActivity?: AgentActivity;
  troubleshooting?: TroubleshootingState[];
  debuggerTabs?: number[];
}

export type TroubleshootingKind =
  | 'extension-not-connected'
  | 'service-worker-idle'
  | 'debugger-attach-blocked'
  | 'permission-denied'
  | 'no-active-tab';

export interface TroubleshootingState {
  kind: TroubleshootingKind;
  message: string;
  at: number;
}

export interface BrowserTabSummary {
  id: number;
  windowId: number;
  title?: string;
  url?: string;
  favIconUrl?: string;
  active: boolean;
  groupId?: number;
}

export interface AgentActivity {
  id: string;
  kind: string;
  label: string;
  tabId?: number;
  createdAt: number;
  status: 'pending' | 'running' | 'completed' | 'rejected' | 'failed';
}

export interface ChatMessage {
  id: string;
  author: 'user' | 'agent' | 'system';
  text: string;
  createdAt: number;
}

export interface OutputEvent {
  id: string;
  kind: 'connection' | 'tab' | 'activity' | 'snapshot' | 'error' | 'command' | 'debug' | 'recording' | 'screenshot';
  title: string;
  detail?: string;
  createdAt: number;
  status?: AgentActivity['status'];
  activityId?: string;
}

// -----------------------------------------------------------------------------
// Page snapshot (enriched)
// -----------------------------------------------------------------------------

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewportInfo {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  devicePixelRatio: number;
}

export interface PageControl {
  ref: string;
  tag: string;
  text: string;
  role?: string;
  ariaLabel?: string;
  ariaName?: string;
  name?: string;
  id?: string;
  type?: string;
  href?: string;
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  checked?: boolean;
  selector: string;
  box?: BoundingBox;
  inIframe?: boolean;
  iframeIndex?: number;
}

export interface FormField {
  name?: string;
  type?: string;
  ref: string;
  required?: boolean;
  label?: string;
}

export interface FormMeta {
  ref: string;
  name?: string;
  id?: string;
  action?: string;
  method?: string;
  fields: FormField[];
}

export interface IframeBoundary {
  index: number;
  src?: string;
  box?: BoundingBox;
  crossOrigin: boolean;
}

export interface PageSnapshot {
  title: string;
  url: string;
  text: string;
  controls: PageControl[];
  forms?: FormMeta[];
  iframes?: IframeBoundary[];
  viewport?: ViewportInfo;
  capturedAt: number;
  untrusted: true;
}

// -----------------------------------------------------------------------------
// Debug entries (redacted)
// -----------------------------------------------------------------------------

export interface ConsoleEntry {
  level: string;
  text: string;
  url?: string;
  line?: number;
  at: number;
  untrusted: true;
}

export interface NetworkEntry {
  requestId: string;
  method?: string;
  url: string;
  status?: number;
  resourceType?: string;
  requestSize?: number;
  responseSize?: number;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  failed?: boolean;
  errorText?: string;
  untrusted: true;
}

// -----------------------------------------------------------------------------
// Recording
// -----------------------------------------------------------------------------

export interface RecordedAction {
  at: number;
  kind: string;
  detail?: Record<string, unknown>;
}

export interface Recording {
  id: string;
  tabId?: number;
  startedAt: number;
  stoppedAt?: number;
  actions: RecordedAction[];
  note?: string;
}

// -----------------------------------------------------------------------------
// UI <-> background messaging (React hooks)
// -----------------------------------------------------------------------------

export type UiCommand =
  | { type: 'connect'; settings?: Partial<BridgeSettings> }
  | { type: 'disconnect' }
  | { type: 'getState' }
  | { type: 'getChat' }
  | { type: 'getOutputs' }
  | { type: 'getDebug'; tabId?: number }
  | { type: 'getRecordings' }
  | { type: 'getPermissions' }
  | { type: 'setPermission'; origin: string; perms: Partial<SitePermissions> }
  | { type: 'removePermission'; origin: string }
  | { type: 'sendChat'; text: string }
  | { type: 'updateSettings'; settings: Partial<BridgeSettings> }
  | { type: 'approveActivity'; id: string }
  | { type: 'rejectActivity'; id: string };

export type UiResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface DebugSummary {
  tabId: number;
  console: ConsoleEntry[];
  network: NetworkEntry[];
}

// -----------------------------------------------------------------------------
// extension -> gode unsolicited events
// -----------------------------------------------------------------------------

export type BridgeEvent =
  | { type: 'hello'; source: 'roder-chrome'; version: string; capabilities: string[] }
  | { type: 'state'; state: BridgeState }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'output'; output: OutputEvent }
  | { type: 'tabs/list'; tabs: BrowserTabSummary[] }
  | { type: 'tab/updated'; tab: BrowserTabSummary }
  | { type: 'page/snapshot'; tab: BrowserTabSummary; snapshot: PageSnapshot }
  | { type: 'activity'; activity: AgentActivity }
  | { type: 'debug/console'; tabId: number; entry: ConsoleEntry }
  | { type: 'debug/network'; tabId: number; entry: NetworkEntry };

// -----------------------------------------------------------------------------
// gode -> extension commands
// -----------------------------------------------------------------------------

export type SnapshotInclude = 'text' | 'controls' | 'forms' | 'iframes' | 'boxes';

export type AgentCommand =
  // chat
  | { type: 'chat'; id?: string; text: string }
  // tabs
  | { type: 'tabs/list'; id?: string }
  | { type: 'tab/activate'; id?: string; tabId: number }
  | { type: 'tab/open'; id?: string; url: string; active?: boolean }
  | { type: 'tab/close'; id?: string; tabId: number }
  | { type: 'tab/navigate'; id?: string; tabId?: number; url: string }
  | { type: 'tabs/group'; id?: string; tabIds: number[]; title?: string }
  // inspect
  | { type: 'page/snapshot'; id?: string; tabId?: number; include?: SnapshotInclude[] }
  | { type: 'page/screenshot'; id?: string; tabId?: number; region?: BoundingBox }
  | { type: 'page/getText'; id?: string; tabId?: number }
  // interact
  | { type: 'page/click'; id?: string; tabId?: number; selector?: string; text?: string; ref?: string }
  | { type: 'page/type'; id?: string; tabId?: number; selector?: string; ref?: string; text: string; submit?: boolean }
  | { type: 'page/keypress'; id?: string; tabId?: number; key: string }
  | { type: 'page/scroll'; id?: string; tabId?: number; selector?: string; dx?: number; dy?: number }
  | { type: 'page/select'; id?: string; tabId?: number; selector: string; value: string }
  | { type: 'page/highlight'; id?: string; tabId?: number; selector?: string; text?: string; ref?: string }
  | { type: 'page/upload'; id?: string; tabId?: number; selector: string; fileRefs: string[] }
  | { type: 'page/eval'; id?: string; tabId?: number; expression: string }
  // debug
  | { type: 'debug/attach'; id?: string; tabId?: number }
  | { type: 'debug/detach'; id?: string; tabId?: number }
  | { type: 'debug/console/read'; id?: string; tabId?: number; limit?: number }
  | { type: 'debug/network/read'; id?: string; tabId?: number; limit?: number }
  // recording
  | { type: 'recording/start'; id?: string; tabId?: number }
  | { type: 'recording/stop'; id?: string; recordingId: string }
  // permissions
  | { type: 'permissions/get'; id?: string; origin?: string }
  | { type: 'permissions/set'; id?: string; origin: string; perms: Partial<SitePermissions> };

export type AgentCommandType = AgentCommand['type'];

export interface CommandResult {
  type: 'command/result';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

// -----------------------------------------------------------------------------
// Parsing / serialization
// -----------------------------------------------------------------------------

/**
 * Normalize a raw inbound message (string or object) into an AgentCommand.
 * Accepts both the native envelope `{ type, id, ...params }` and JSON-RPC
 * `{ id, method, params }` (mapping method -> type and spreading params).
 * Returns null when the payload cannot be parsed into a typed command.
 */
export function parseAgentCommand(raw: unknown): AgentCommand | null {
  let parsed: unknown;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const obj = parsed as Record<string, unknown>;

  // JSON-RPC shape: { id, method, params }
  if (typeof obj.method === 'string') {
    const params = (obj.params && typeof obj.params === 'object' ? obj.params : {}) as Record<string, unknown>;
    return { type: obj.method, id: obj.id !== undefined ? String(obj.id) : undefined, ...params } as AgentCommand;
  }

  // Native shape: { type, id, ...params }
  if (typeof obj.type === 'string') {
    return { ...obj, id: obj.id !== undefined ? String(obj.id) : undefined } as AgentCommand;
  }

  return null;
}

/** Build the canonical command result envelope. */
export function makeCommandResult(id: string | undefined, ok: boolean, result?: unknown, error?: string): CommandResult | null {
  if (!id) return null;
  return { type: 'command/result', id, ok, result, error };
}

/** Build the connect-time hello envelope. */
export function makeHello(version: string, capabilities: string[]): Extract<BridgeEvent, { type: 'hello' }> {
  return { type: 'hello', source: 'roder-chrome', version, capabilities };
}

// -----------------------------------------------------------------------------
// Defaults / storage keys
// -----------------------------------------------------------------------------

export const defaultSettings: BridgeSettings = {
  endpoint: 'ws://127.0.0.1:0',
  token: '',
  autoConnect: false,
  controlMode: 'assist',
  allowPageInspection: true,
  allowNavigation: false,
  allowInput: false,
  allowEval: false,
  allowDebugger: false,
  allowDownload: false,
  allowUpload: false,
  allowRecording: false,
};

export const storageKeys = {
  settings: 'roderChrome.settings',
  chat: 'roderChrome.chat',
  outputs: 'roderChrome.outputs',
  permissions: 'roderChrome.permissions',
} as const;
