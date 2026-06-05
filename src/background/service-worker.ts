/// <reference types="chrome" />

// =============================================================================
// Roder Chrome bridge service worker — the central dispatcher.
//
// Responsibilities:
//  - Own the WebSocket connection to the Roder app-server (gode).
//  - Parse inbound gode->ext commands and route them to handlers.
//  - Gate every privileged command on (control mode AND per-origin permission).
//  - Maintain bridge state, chat, outputs, debugger buffers, recordings.
//  - Respond to React UI messages.
//
// Heavy logic is split into ./permissions, ./debugger, ./recording, and the
// content-script modules. This file stays the orchestration layer.
// =============================================================================

import type {
  AgentActivity,
  AgentCommand,
  BridgeEvent,
  BridgeSettings,
  BridgeState,
  BrowserTabSummary,
  ChatMessage,
  OutputEvent,
  SitePermission,
  TroubleshootingKind,
  UiCommand,
  UiResponse,
} from '../shared/protocol';
import { CAPABILITIES, makeHello, parseAgentCommand } from '../shared/protocol';
import { loadChat, loadOutputs, loadSettings, saveChat, saveOutputs, saveSettings } from '../shared/storage';
import { createId, isExtensionPage, now, safeUrl, tokenPreview } from '../shared/utils';
import * as perms from './permissions';
import * as dbg from './debugger';
import * as rec from './recording';

let settings: BridgeSettings;
let state: BridgeState;
let chat: ChatMessage[] = [];
let outputs: OutputEvent[] = [];
let socket: WebSocket | null = null;
let reconnectTimer: number | undefined;
const pendingActivities = new Map<string, AgentCommand>();
const troubleshooting = new Map<TroubleshootingKind, { message: string; at: number }>();

// Tabs opened through the bridge are collected into a single reusable Chrome tab
// group named "Roder" (per window) so the user can see, collapse, or close
// everything Roder opened at a glance.
const RODER_TAB_GROUP_TITLE = 'Roder';

async function addTabToRoderGroup(
  tabId: number | undefined,
  windowId: number | undefined,
): Promise<number | undefined> {
  if (tabId === undefined || !chrome.tabGroups || !chrome.tabs.group) return undefined;
  try {
    const query: chrome.tabGroups.QueryInfo = { title: RODER_TAB_GROUP_TITLE };
    if (windowId !== undefined) query.windowId = windowId;
    const tabIds: [number] = [tabId];
    const existing = await chrome.tabGroups.query(query);
    if (existing.length > 0) {
      return await chrome.tabs.group({ tabIds, groupId: existing[0].id });
    }
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, { title: RODER_TAB_GROUP_TITLE, color: 'blue' });
    return groupId;
  } catch {
    return undefined;
  }
}

// -----------------------------------------------------------------------------
// Init
// -----------------------------------------------------------------------------

async function init(): Promise<void> {
  settings = await loadSettings();
  chat = await loadChat();
  outputs = await loadOutputs();
  state = {
    status: 'disconnected',
    endpoint: settings.endpoint,
    tokenPreview: tokenPreview(settings.token),
    controlMode: settings.controlMode,
    activeTab: await getActiveTab(),
    debuggerTabs: [],
  };

  dbg.onDebugStream((event) => {
    sendToAgent(event);
    const detail =
      event.type === 'debug/console'
        ? `[${event.entry.level}] ${event.entry.text.slice(0, 200)}`
        : `${event.entry.method ?? ''} ${event.entry.status ?? ''} ${event.entry.url}`.trim().slice(0, 200);
    addOutput('debug', `${event.type === 'debug/console' ? 'console' : 'network'} · tab ${event.tabId}`, detail);
  });

  chrome.tabs.onActivated.addListener(() => void publishActiveTab());
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.status === 'complete' || changeInfo.title || changeInfo.url) void publishActiveTab();
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void dbg.detach(tabId).catch(() => undefined);
    syncDebuggerTabs();
  });

  if (settings.autoConnect && settings.endpoint && settings.token) connect();
}

// -----------------------------------------------------------------------------
// Outputs / state / troubleshooting
// -----------------------------------------------------------------------------

function addOutput(kind: OutputEvent['kind'], title: string, detail?: string, status?: OutputEvent['status'], activityId?: string): void {
  const output: OutputEvent = { id: createId('output'), kind, title, detail, createdAt: now(), status, activityId };
  outputs = [...outputs, output].slice(-300);
  void saveOutputs(outputs);
  void chrome.runtime.sendMessage({ type: 'output', output }).catch(() => undefined);
  sendToAgent({ type: 'output', output });
}

function setTroubleshooting(kind: TroubleshootingKind, message: string | null): void {
  if (message === null) troubleshooting.delete(kind);
  else troubleshooting.set(kind, { message, at: now() });
  state = { ...state, troubleshooting: Array.from(troubleshooting.entries()).map(([k, v]) => ({ kind: k, message: v.message, at: v.at })) };
}

function syncDebuggerTabs(): void {
  state = { ...state, debuggerTabs: dbg.attachedTabs() };
  publishState();
}

function publishState(): void {
  const event: BridgeEvent = { type: 'state', state };
  void chrome.runtime.sendMessage(event).catch(() => undefined);
  sendToAgent(event);
}

function setStatus(status: BridgeState['status'], lastError?: string): void {
  state = {
    ...state,
    status,
    lastError,
    endpoint: settings.endpoint,
    tokenPreview: tokenPreview(settings.token),
    controlMode: settings.controlMode,
  };
  if (status === 'connected') setTroubleshooting('extension-not-connected', null);
  else if (status === 'disconnected') setTroubleshooting('extension-not-connected', 'Extension is not connected to Roder.');
  publishState();
  if (lastError) addOutput('error', 'Bridge error', lastError);
}

// -----------------------------------------------------------------------------
// Tabs
// -----------------------------------------------------------------------------

async function getActiveTab(): Promise<BrowserTabSummary | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return summarizeTab(tab);
}

function summarizeTab(tab?: chrome.tabs.Tab): BrowserTabSummary | undefined {
  if (!tab?.id) return undefined;
  return {
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title,
    url: tab.url,
    favIconUrl: tab.favIconUrl,
    active: Boolean(tab.active),
    groupId: tab.groupId,
  };
}

async function listTabs(): Promise<BrowserTabSummary[]> {
  const tabs = await chrome.tabs.query({});
  return tabs.map(summarizeTab).filter(Boolean) as BrowserTabSummary[];
}

async function publishActiveTab(): Promise<void> {
  const tab = await getActiveTab();
  state = { ...state, activeTab: tab };
  if (tab) {
    setTroubleshooting('no-active-tab', null);
    sendToAgent({ type: 'tab/updated', tab });
    addOutput('tab', tab.title ?? 'Active tab changed', tab.url);
  } else {
    setTroubleshooting('no-active-tab', 'No active tab is available.');
  }
  publishState();
}

async function resolveTab(tabId?: number): Promise<BrowserTabSummary> {
  const tab = tabId ? summarizeTab(await chrome.tabs.get(tabId)) : await getActiveTab();
  if (!tab?.id) {
    setTroubleshooting('no-active-tab', 'No active tab is available.');
    throw new Error('No active tab is available.');
  }
  if (isExtensionPage(tab.url)) throw new Error('Chrome internal and extension pages cannot be controlled.');
  return tab;
}

// -----------------------------------------------------------------------------
// WebSocket connection
// -----------------------------------------------------------------------------

function connect(): void {
  clearReconnect();
  if (!settings.endpoint || !settings.token) {
    setStatus('error', 'Endpoint and token are required.');
    return;
  }

  try {
    setStatus('connecting');
    socket?.close();
    socket = new WebSocket(settings.endpoint, ['roder.remote.v1', `bearer.${settings.token}`]);

    socket.addEventListener('open', () => {
      state = { ...state, status: 'connected', connectedAt: now(), lastError: undefined };
      setTroubleshooting('extension-not-connected', null);
      publishState();
      addOutput('connection', 'Connected to Roder', settings.endpoint);
      sendToAgent(makeHello(chrome.runtime.getManifest().version, capabilities()));
      void listTabs().then((tabs) => sendToAgent({ type: 'tabs/list', tabs }));
    });

    socket.addEventListener('message', (event) => handleAgentMessage(event.data));
    socket.addEventListener('close', () => {
      socket = null;
      setStatus('disconnected');
      addOutput('connection', 'Disconnected from Roder', settings.endpoint);
      if (settings.autoConnect) scheduleReconnect();
    });
    socket.addEventListener('error', () =>
      setStatus('error', 'WebSocket connection failed. Check the /remote pairing URL and token.'),
    );
  } catch (error) {
    setStatus('error', error instanceof Error ? error.message : String(error));
  }
}

function disconnect(): void {
  clearReconnect();
  settings = { ...settings, autoConnect: false };
  void saveSettings(settings);
  socket?.close();
  socket = null;
  setStatus('disconnected');
  addOutput('connection', 'Disconnected by user', settings.endpoint);
}

function clearReconnect(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
}

function scheduleReconnect(): void {
  clearReconnect();
  reconnectTimer = setTimeout(connect, 3000) as unknown as number;
}

function capabilities(): string[] {
  const caps: string[] = [CAPABILITIES.chat, CAPABILITIES.tabsList, CAPABILITIES.tabActivate, CAPABILITIES.tabOpen, CAPABILITIES.tabClose, CAPABILITIES.tabsGroup, CAPABILITIES.permissions];
  if (settings.allowPageInspection) {
    caps.push(CAPABILITIES.pageSnapshot, CAPABILITIES.pageScreenshot, CAPABILITIES.pageGetText, CAPABILITIES.pageHighlight);
  }
  if (settings.allowNavigation) caps.push(CAPABILITIES.tabNavigate);
  if (settings.allowInput && settings.controlMode === 'control') {
    caps.push(CAPABILITIES.pageClick, CAPABILITIES.pageType, CAPABILITIES.pageKeypress, CAPABILITIES.pageScroll, CAPABILITIES.pageSelect);
  }
  if (settings.allowEval && settings.controlMode === 'control') caps.push(CAPABILITIES.pageEval);
  if (settings.allowDebugger) caps.push(CAPABILITIES.debug);
  if (settings.allowRecording) caps.push(CAPABILITIES.recording);
  if (settings.allowUpload) caps.push(CAPABILITIES.pageUpload);
  return caps;
}

function sendToAgent(event: BridgeEvent | Record<string, unknown>): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
}

function sendAgentResult(id: string | undefined, result: unknown, error?: string): void {
  if (!id) return;
  sendToAgent({ type: 'command/result', id, ok: !error, result, error });
  addOutput(
    error ? 'error' : 'command',
    error ? `Command failed: ${id}` : `Command result: ${id}`,
    error ?? JSON.stringify(result).slice(0, 600),
  );
}

// -----------------------------------------------------------------------------
// Inbound command handling
// -----------------------------------------------------------------------------

function handleAgentMessage(raw: unknown): void {
  const command = parseAgentCommand(raw);
  if (!command) {
    addOutput('error', 'Could not parse agent command', typeof raw === 'string' ? raw.slice(0, 200) : 'non-string payload');
    return;
  }
  addOutput('command', `Agent command: ${command.type}`, JSON.stringify(command).slice(0, 900));
  void runAgentCommand(command);
}

/**
 * Gate a privileged command on (mode AND per-origin permission). If allowed:
 * - control mode -> execute immediately
 * - assist mode  -> queue for user approval
 * - the origin's `alwaysAllow` flag bypasses queuing even in assist mode.
 */
async function gate(
  command: AgentCommand,
  label: string,
  opts: { modeAllowed: boolean; sitePerm: SitePermission; tabUrl?: string; needsControl?: boolean },
): Promise<void> {
  if (!opts.modeAllowed) {
    setTroubleshooting('permission-denied', `${label} is disabled by current settings/mode.`);
    throw new Error(`${label} is not allowed by current settings.`);
  }
  const granted = await perms.checkPermission(opts.tabUrl, opts.sitePerm);
  if (!granted) {
    setTroubleshooting('permission-denied', `${label}: origin lacks "${opts.sitePerm}" permission.`);
    throw new Error(`${label} is not permitted for this site (missing "${opts.sitePerm}" permission).`);
  }
  setTroubleshooting('permission-denied', null);

  const alwaysAllow = !(await perms.requiresApproval(opts.tabUrl));
  const immediate = settings.controlMode === 'control' || alwaysAllow;

  const activity: AgentActivity = {
    id: createId('activity'),
    kind: command.type,
    label,
    tabId: 'tabId' in command ? command.tabId : undefined,
    createdAt: now(),
    status: immediate ? 'running' : 'pending',
  };
  state = { ...state, lastAgentActivity: activity };
  sendToAgent({ type: 'activity', activity });
  addOutput('activity', activity.label, `${activity.kind}${activity.tabId ? ` · tab ${activity.tabId}` : ''}`, activity.status, activity.id);
  publishState();

  if (!immediate) {
    pendingActivities.set(activity.id, command);
    return;
  }
  await executePrivileged(command, activity.id);
}

async function runAgentCommand(command: AgentCommand): Promise<void> {
  try {
    const commandType = (command as { type: string }).type;
    if (commandType.startsWith('desktop/')) {
      addOutput('connection', 'Roder Desktop bridge', commandType);
      return;
    }

    switch (command.type) {
      // ---- chat ----
      case 'chat':
        await addChat('agent', command.text);
        sendAgentResult(command.id, { delivered: true });
        return;

      // ---- tabs (read / low-risk) ----
      case 'tabs/list':
        sendAgentResult(command.id, { tabs: await listTabs() });
        return;
      case 'tab/activate':
        await chrome.tabs.update(command.tabId, { active: true });
        rec.recordAction('tab/activate', command.tabId, { tabId: command.tabId });
        sendAgentResult(command.id, { tabId: command.tabId });
        return;
      case 'tab/open': {
        const url = safeUrl(command.url);
        if (!url) throw new Error('Only http(s) URLs can be opened.');
        const tab = await chrome.tabs.create({ url, active: command.active ?? true });
        const groupId = await addTabToRoderGroup(tab.id, tab.windowId);
        rec.recordAction('tab/open', tab.id, { url, groupId });
        sendAgentResult(command.id, { tabId: tab.id, url, groupId });
        return;
      }
      case 'tab/close':
        await chrome.tabs.remove(command.tabId);
        rec.recordAction('tab/close', command.tabId, { tabId: command.tabId });
        sendAgentResult(command.id, { closed: command.tabId });
        return;
      case 'tabs/group': {
        if (!command.tabIds?.length) throw new Error('tabs/group requires at least one tabId.');
        const tabIds = command.tabIds as [number, ...number[]];
        const groupId = await chrome.tabs.group({ tabIds });
        if (command.title && chrome.tabGroups) {
          await chrome.tabGroups.update(groupId, { title: command.title });
        }
        rec.recordAction('tabs/group', undefined, { tabIds: command.tabIds, groupId });
        sendAgentResult(command.id, { groupId });
        return;
      }

      // ---- navigation (privileged) ----
      case 'tab/navigate': {
        const tab = await resolveTab(command.tabId);
        await gate(command, 'Navigate tab', { modeAllowed: settings.allowNavigation, sitePerm: 'interact', tabUrl: tab.url });
        return;
      }

      // ---- inspect ----
      case 'page/snapshot': {
        const tab = await resolveTab(command.tabId);
        await ensureInspectAllowed(tab.url);
        const snapshot = await sendContentMessage(tab.id, { type: 'snapshot', include: command.include });
        sendToAgent({ type: 'page/snapshot', tab, snapshot: snapshot.snapshot });
        addOutput('snapshot', `Snapshot: ${tab.title ?? tab.url ?? 'tab'}`, `${snapshot.snapshot.controls?.length ?? 0} controls · ${snapshot.snapshot.text?.length ?? 0} chars`);
        sendAgentResult(command.id, snapshot);
        return;
      }
      case 'page/getText': {
        const tab = await resolveTab(command.tabId);
        await ensureInspectAllowed(tab.url);
        const response = await sendContentMessage(tab.id, { type: 'getText' });
        sendAgentResult(command.id, { text: response.text, untrusted: true });
        return;
      }
      case 'page/screenshot': {
        const tab = await resolveTab(command.tabId);
        await ensureInspectAllowed(tab.url);
        const dataUrl = await captureScreenshot(tab.windowId, command.region);
        addOutput('screenshot', `Screenshot: ${tab.title ?? tab.url ?? 'tab'}`, command.region ? 'full capture (region crop unsupported in MV3 SW)' : 'full capture');
        sendAgentResult(command.id, {
          dataUrl,
          untrusted: true,
          note: command.region ? 'Region cropping is not supported in an MV3 service worker (no DOM canvas); full visible-tab capture returned.' : undefined,
        });
        return;
      }

      // ---- interact (privileged) ----
      case 'page/highlight': {
        const tab = await resolveTab(command.tabId);
        await gate(command, 'Highlight element', { modeAllowed: settings.allowPageInspection, sitePerm: 'inspect', tabUrl: tab.url });
        return;
      }
      case 'page/click': {
        const tab = await resolveTab(command.tabId);
        await gate(command, 'Click element', { modeAllowed: settings.allowInput && settings.controlMode === 'control', sitePerm: 'interact', tabUrl: tab.url });
        return;
      }
      case 'page/type': {
        const tab = await resolveTab(command.tabId);
        await gate(command, 'Type into element', { modeAllowed: settings.allowInput && settings.controlMode === 'control', sitePerm: 'interact', tabUrl: tab.url });
        return;
      }
      case 'page/keypress': {
        const tab = await resolveTab(command.tabId);
        await gate(command, 'Send keypress', { modeAllowed: settings.allowInput && settings.controlMode === 'control', sitePerm: 'interact', tabUrl: tab.url });
        return;
      }
      case 'page/scroll': {
        const tab = await resolveTab(command.tabId);
        await gate(command, 'Scroll page', { modeAllowed: settings.allowInput && settings.controlMode === 'control', sitePerm: 'interact', tabUrl: tab.url });
        return;
      }
      case 'page/select': {
        const tab = await resolveTab(command.tabId);
        await gate(command, 'Select option', { modeAllowed: settings.allowInput && settings.controlMode === 'control', sitePerm: 'interact', tabUrl: tab.url });
        return;
      }
      case 'page/upload': {
        // File uploads require a user-initiated file chooser; the extension
        // cannot synthesize file selection from arbitrary refs.
        throw new Error('page/upload requires user file selection; programmatic upload of file refs is not possible in MV3. Ask the user to attach files via the page UI.');
      }
      case 'page/eval': {
        const tab = await resolveTab(command.tabId);
        await gate(command, 'Evaluate script', { modeAllowed: settings.allowEval && settings.controlMode === 'control', sitePerm: 'eval', tabUrl: tab.url });
        return;
      }

      // ---- debug ----
      case 'debug/attach': {
        const tab = await resolveTab(command.tabId);
        await gate(command, 'Attach debugger', { modeAllowed: settings.allowDebugger, sitePerm: 'debugger', tabUrl: tab.url });
        return;
      }
      case 'debug/detach': {
        const tab = await resolveTab(command.tabId);
        await dbg.detach(tab.id);
        syncDebuggerTabs();
        sendAgentResult(command.id, { detached: tab.id });
        return;
      }
      case 'debug/console/read': {
        const tab = await resolveTab(command.tabId);
        sendAgentResult(command.id, { entries: dbg.readConsole(tab.id, command.limit) });
        return;
      }
      case 'debug/network/read': {
        const tab = await resolveTab(command.tabId);
        sendAgentResult(command.id, { entries: dbg.readNetwork(tab.id, command.limit) });
        return;
      }

      // ---- recording ----
      case 'recording/start': {
        if (!settings.allowRecording) throw new Error('Recording is disabled by current settings.');
        const tab = command.tabId ? await resolveTab(command.tabId) : undefined;
        if (tab && !(await perms.checkPermission(tab.url, 'recording'))) {
          throw new Error('Recording is not permitted for this site.');
        }
        const recording = rec.startRecording(tab?.id ?? command.tabId);
        addOutput('recording', `Recording started: ${recording.id}`, tab?.url);
        sendAgentResult(command.id, { recordingId: recording.id, startedAt: recording.startedAt, note: recording.note });
        return;
      }
      case 'recording/stop': {
        const recording = rec.stopRecording(command.recordingId);
        addOutput('recording', `Recording stopped: ${recording.id}`, `${recording.actions.length} actions`);
        sendAgentResult(command.id, recording);
        return;
      }

      // ---- permissions ----
      case 'permissions/get': {
        if (command.origin) {
          sendAgentResult(command.id, { origin: command.origin, perms: await perms.getPermissions(command.origin) });
        } else {
          sendAgentResult(command.id, { entries: await perms.listPermissions() });
        }
        return;
      }
      case 'permissions/set': {
        const merged = await perms.setPermissions(command.origin, command.perms);
        addOutput('command', `Permissions updated: ${command.origin}`, JSON.stringify(command.perms));
        sendAgentResult(command.id, { origin: command.origin, perms: merged });
        return;
      }

      default:
        throw new Error(`Unsupported command: ${(command as { type: string }).type}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addOutput('error', `Command blocked: ${command.type}`, message);
    sendAgentResult(command.id, null, message);
  }
}

async function ensureInspectAllowed(url: string | undefined): Promise<void> {
  if (!settings.allowPageInspection) throw new Error('Page inspection is disabled by the user.');
  if (!(await perms.checkPermission(url, 'inspect'))) {
    setTroubleshooting('permission-denied', 'Inspect permission missing for this origin.');
    throw new Error('Inspection is not permitted for this site (missing "inspect" permission).');
  }
  setTroubleshooting('permission-denied', null);
}

async function captureScreenshot(windowId: number, region?: unknown): Promise<string> {
  void region; // region cropping unsupported in SW; documented in result note.
  return chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
}

// -----------------------------------------------------------------------------
// Privileged execution (called immediately in control mode or after approval)
// -----------------------------------------------------------------------------

async function executePrivileged(command: AgentCommand, activityId: string): Promise<void> {
  try {
    let result: unknown;
    switch (command.type) {
      case 'tab/navigate': {
        const tab = await resolveTab(command.tabId);
        const url = safeUrl(command.url);
        if (!url) throw new Error('Only http(s) navigation is allowed.');
        result = await chrome.tabs.update(tab.id, { url });
        rec.recordAction('tab/navigate', tab.id, { url });
        break;
      }
      case 'page/highlight': {
        const tab = await resolveTab(command.tabId);
        result = await sendContentMessage(tab.id, { type: 'highlight', selector: command.selector, text: command.text, ref: command.ref });
        break;
      }
      case 'page/click': {
        const tab = await resolveTab(command.tabId);
        result = await sendContentMessage(tab.id, { type: 'click', selector: command.selector, text: command.text, ref: command.ref });
        rec.recordAction('page/click', tab.id, { selector: command.selector, text: command.text, ref: command.ref });
        break;
      }
      case 'page/type': {
        const tab = await resolveTab(command.tabId);
        result = await sendContentMessage(tab.id, { type: 'type', selector: command.selector, ref: command.ref, text: command.text, submit: command.submit });
        rec.recordAction('page/type', tab.id, { selector: command.selector, ref: command.ref, submit: command.submit });
        break;
      }
      case 'page/keypress': {
        const tab = await resolveTab(command.tabId);
        result = await sendContentMessage(tab.id, { type: 'keypress', key: command.key });
        rec.recordAction('page/keypress', tab.id, { key: command.key });
        break;
      }
      case 'page/scroll': {
        const tab = await resolveTab(command.tabId);
        result = await sendContentMessage(tab.id, { type: 'scroll', selector: command.selector, dx: command.dx, dy: command.dy });
        rec.recordAction('page/scroll', tab.id, { dx: command.dx, dy: command.dy });
        break;
      }
      case 'page/select': {
        const tab = await resolveTab(command.tabId);
        result = await sendContentMessage(tab.id, { type: 'select', selector: command.selector, value: command.value });
        rec.recordAction('page/select', tab.id, { selector: command.selector });
        break;
      }
      case 'page/eval': {
        const tab = await resolveTab(command.tabId);
        result = await evalInTab(tab.id, command.expression);
        rec.recordAction('page/eval', tab.id, { expression: command.expression.slice(0, 120) });
        break;
      }
      case 'debug/attach': {
        const tab = await resolveTab(command.tabId);
        try {
          await dbg.attach(tab.id);
        } catch (error) {
          setTroubleshooting('debugger-attach-blocked', error instanceof Error ? error.message : String(error));
          throw error;
        }
        setTroubleshooting('debugger-attach-blocked', null);
        syncDebuggerTabs();
        result = { attached: tab.id };
        break;
      }
      default:
        throw new Error(`Cannot execute command: ${(command as { type: string }).type}`);
    }
    updateActivity(activityId, 'completed');
    sendAgentResult(command.id, result ?? { ok: true });
  } catch (error) {
    updateActivity(activityId, 'failed');
    sendAgentResult(command.id, null, error instanceof Error ? error.message : String(error));
  }
}

async function evalInTab(tabId: number, expression: string): Promise<unknown> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (code: string) => {
      try {
        // eslint-disable-next-line no-new-func
        const value = new Function(`return (${code})`)();
        return { ok: true, value: typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    args: [expression],
  });
  const out = injection?.result as { ok: boolean; value?: unknown; error?: string } | undefined;
  if (!out?.ok) throw new Error(out?.error ?? 'Evaluation failed.');
  return { value: out.value, untrusted: true };
}

function updateActivity(id: string, status: AgentActivity['status']): void {
  const activity = state.lastAgentActivity;
  if (activity?.id === id) {
    const updated = { ...activity, status };
    state = { ...state, lastAgentActivity: updated };
    addOutput('activity', updated.label, updated.kind, status, id);
    publishState();
  }
}

// -----------------------------------------------------------------------------
// Content-script messaging
// -----------------------------------------------------------------------------

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ping' });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/content-script.js'] });
  }
}

async function sendContentMessage(tabId: number, message: Record<string, unknown>): Promise<any> {
  await ensureContentScript(tabId);
  const response = await chrome.tabs.sendMessage(tabId, message);
  if (!response?.ok) throw new Error(response?.error ?? 'Content script command failed.');
  return response;
}

// -----------------------------------------------------------------------------
// Chat
// -----------------------------------------------------------------------------

async function addChat(author: ChatMessage['author'], text: string): Promise<ChatMessage> {
  const message: ChatMessage = { id: createId('chat'), author, text, createdAt: now() };
  chat = [...chat, message].slice(-200);
  await saveChat(chat);
  void chrome.runtime.sendMessage({ type: 'chat', message }).catch(() => undefined);
  sendToAgent({ type: 'chat', message });
  return message;
}

// -----------------------------------------------------------------------------
// UI (React) messaging
// -----------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((command: UiCommand, _sender, sendResponse: (response: UiResponse) => void) => {
  void (async () => {
    try {
      switch (command.type) {
        case 'getState':
          sendResponse({ ok: true, data: state });
          break;
        case 'getChat':
          sendResponse({ ok: true, data: chat });
          break;
        case 'getOutputs':
          sendResponse({ ok: true, data: outputs });
          break;
        case 'getDebug': {
          const tabId = command.tabId ?? state.activeTab?.id;
          if (!tabId) {
            sendResponse({ ok: true, data: { tabId: 0, console: [], network: [] } });
            break;
          }
          sendResponse({ ok: true, data: { tabId, console: dbg.readConsole(tabId), network: dbg.readNetwork(tabId) } });
          break;
        }
        case 'getRecordings':
          sendResponse({ ok: true, data: rec.listRecordings() });
          break;
        case 'getPermissions':
          sendResponse({ ok: true, data: await perms.listPermissions() });
          break;
        case 'setPermission':
          await perms.setPermissions(command.origin, command.perms);
          sendResponse({ ok: true, data: await perms.listPermissions() });
          break;
        case 'removePermission':
          await perms.removePermissions(command.origin);
          sendResponse({ ok: true, data: await perms.listPermissions() });
          break;
        case 'connect':
          settings = { ...settings, ...(command.settings ?? {}), autoConnect: true };
          await saveSettings(settings);
          connect();
          sendResponse({ ok: true, data: state });
          break;
        case 'disconnect':
          disconnect();
          sendResponse({ ok: true, data: state });
          break;
        case 'sendChat':
          sendResponse({ ok: true, data: await addChat('user', command.text) });
          break;
        case 'updateSettings':
          settings = { ...settings, ...command.settings };
          await saveSettings(settings);
          state = { ...state, endpoint: settings.endpoint, tokenPreview: tokenPreview(settings.token), controlMode: settings.controlMode };
          publishState();
          sendResponse({ ok: true, data: state });
          break;
        case 'approveActivity': {
          const pending = pendingActivities.get(command.id);
          if (!pending) throw new Error('Activity not found.');
          pendingActivities.delete(command.id);
          await executePrivileged(pending, command.id);
          sendResponse({ ok: true, data: state });
          break;
        }
        case 'rejectActivity': {
          const pending = pendingActivities.get(command.id);
          pendingActivities.delete(command.id);
          updateActivity(command.id, 'rejected');
          sendAgentResult(pending?.id, null, 'Rejected by user.');
          sendResponse({ ok: true, data: state });
          break;
        }
        default:
          sendResponse({ ok: false, error: `Unknown UI command: ${(command as { type: string }).type}` });
      }
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  })();
  return true;
});

chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
void init();
