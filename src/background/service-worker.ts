import type {
  AgentActivity,
  AgentCommand,
  BridgeEvent,
  BridgeSettings,
  BridgeState,
  BrowserTabSummary,
  ChatMessage,
  OutputEvent,
  UiCommand,
  UiResponse,
} from '../shared/types';
import { loadChat, loadOutputs, loadSettings, saveChat, saveOutputs, saveSettings } from '../shared/storage';
import { createId, isExtensionPage, now, safeUrl, tokenPreview } from '../shared/utils';

let settings: BridgeSettings;
let state: BridgeState;
let chat: ChatMessage[] = [];
let outputs: OutputEvent[] = [];
let socket: WebSocket | null = null;
let reconnectTimer: number | undefined;
const pendingActivities = new Map<string, AgentCommand>();

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
  };

  chrome.tabs.onActivated.addListener(() => publishActiveTab());
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.status === 'complete' || changeInfo.title || changeInfo.url) publishActiveTab();
  });

  if (settings.autoConnect && settings.endpoint && settings.token) connect();
}

function addOutput(kind: OutputEvent['kind'], title: string, detail?: string, status?: OutputEvent['status'], activityId?: string): void {
  const output: OutputEvent = { id: createId('output'), kind, title, detail, createdAt: now(), status, activityId };
  outputs = [...outputs, output].slice(-300);
  void saveOutputs(outputs);
  void chrome.runtime.sendMessage({ type: 'output', output }).catch(() => undefined);
  sendToAgent({ type: 'output', output });
}

function publishState(): void {
  const event: BridgeEvent = { type: 'state', state };
  void chrome.runtime.sendMessage(event).catch(() => undefined);
  sendToAgent(event);
}

function setStatus(status: BridgeState['status'], lastError?: string): void {
  state = { ...state, status, lastError, endpoint: settings.endpoint, tokenPreview: tokenPreview(settings.token), controlMode: settings.controlMode };
  publishState();
  if (lastError) addOutput('error', 'Bridge error', lastError);
}

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
    sendToAgent({ type: 'tab/updated', tab });
    addOutput('tab', tab.title ?? 'Active tab changed', tab.url);
  }
  publishState();
}

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
      publishState();
      addOutput('connection', 'Connected to Roder', settings.endpoint);
      sendToAgent({ type: 'hello', source: 'roder-chrome', version: chrome.runtime.getManifest().version, capabilities: capabilities() });
      void listTabs().then((tabs) => sendToAgent({ type: 'tabs/list', tabs }));
    });

    socket.addEventListener('message', (event) => handleAgentMessage(event.data));
    socket.addEventListener('close', () => {
      socket = null;
      setStatus('disconnected');
      addOutput('connection', 'Disconnected from Roder', settings.endpoint);
      if (settings.autoConnect) scheduleReconnect();
    });
    socket.addEventListener('error', () => setStatus('error', 'WebSocket connection failed. Check the /remote pairing URL and token.'));
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
  if (reconnectTimer) window.clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
}

function scheduleReconnect(): void {
  clearReconnect();
  reconnectTimer = window.setTimeout(connect, 3000);
}

function capabilities(): string[] {
  const caps = ['chat', 'tabs.list', 'tabs.activate'];
  if (settings.allowPageInspection) caps.push('page.snapshot', 'page.highlight');
  if (settings.allowNavigation) caps.push('tab.navigate');
  if (settings.allowInput && settings.controlMode === 'control') caps.push('page.click', 'page.type');
  return caps;
}

function sendToAgent(event: BridgeEvent | Record<string, unknown>): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
}

function sendAgentResult(id: string | undefined, result: unknown, error?: string): void {
  if (!id) return;
  sendToAgent({ type: 'command/result', id, ok: !error, result, error });
  addOutput(error ? 'error' : 'command', error ? `Command failed: ${id}` : `Command result: ${id}`, error ?? JSON.stringify(result).slice(0, 600));
}

function parseAgentCommand(raw: unknown): AgentCommand | null {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object' && 'method' in parsed) {
      const rpc = parsed as { id?: string; method: string; params?: Record<string, unknown> };
      return { type: rpc.method, id: String(rpc.id ?? ''), ...(rpc.params ?? {}) } as AgentCommand;
    }
    return parsed as AgentCommand;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addOutput('error', 'Could not parse agent command', message);
    sendAgentResult(undefined, null, message);
    return null;
  }
}

function handleAgentMessage(raw: unknown): void {
  const command = parseAgentCommand(raw);
  if (!command) return;
  addOutput('command', `Agent command: ${command.type}`, JSON.stringify(command).slice(0, 900));
  void runAgentCommand(command);
}

async function runAgentCommand(command: AgentCommand): Promise<void> {
  try {
    const commandType = (command as { type: string }).type;
    if (commandType.startsWith("desktop/")) {
      addOutput("connection", "Roder Desktop bridge", commandType);
      return;
    }
    if (command.type === 'chat') {
      await addChat('agent', command.text);
      sendAgentResult(command.id, { delivered: true });
      return;
    }

    if (command.type === 'tabs/list') {
      sendAgentResult(command.id, { tabs: await listTabs() });
      return;
    }

    if (command.type === 'tab/activate') {
      await chrome.tabs.update(command.tabId, { active: true });
      sendAgentResult(command.id, { tabId: command.tabId });
      return;
    }

    if (command.type === 'tab/navigate') {
      await guardOrQueue(command, 'Navigate active tab', settings.allowNavigation);
      return;
    }

    if (command.type === 'page/snapshot') {
      if (!settings.allowPageInspection) throw new Error('Page inspection is disabled by the user.');
      const tab = await resolveTab(command.tabId);
      const snapshot = await sendContentMessage(tab.id, { type: 'snapshot' });
      sendToAgent({ type: 'page/snapshot', tab, snapshot: snapshot.snapshot });
      addOutput('snapshot', `Snapshot captured: ${tab.title ?? tab.url ?? 'tab'}`, `${snapshot.snapshot.controls?.length ?? 0} controls · ${snapshot.snapshot.text?.length ?? 0} chars`);
      sendAgentResult(command.id, snapshot);
      return;
    }

    if (command.type === 'page/highlight') {
      await guardOrQueue(command, 'Highlight an element', settings.allowPageInspection);
      return;
    }

    if (command.type === 'page/click' || command.type === 'page/type') {
      await guardOrQueue(command, command.type === 'page/click' ? 'Click an element' : 'Type into an element', settings.allowInput && settings.controlMode === 'control');
      return;
    }

    throw new Error(`Unsupported command: ${(command as { type: string }).type}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addOutput('error', `Command blocked: ${command.type}`, message);
    sendAgentResult(command.id, null, message);
  }
}

async function guardOrQueue(command: AgentCommand, label: string, allowed: boolean): Promise<void> {
  if (!allowed) throw new Error(`${label} is not allowed by current settings.`);

  const activity: AgentActivity = {
    id: createId('activity'),
    kind: command.type,
    label,
    tabId: 'tabId' in command ? command.tabId : undefined,
    createdAt: now(),
    status: settings.controlMode === 'control' ? 'running' : 'pending',
  };
  state = { ...state, lastAgentActivity: activity };
  sendToAgent({ type: 'activity', activity });
  addOutput('activity', activity.label, `${activity.kind}${activity.tabId ? ` · tab ${activity.tabId}` : ''}`, activity.status, activity.id);
  publishState();

  if (settings.controlMode !== 'control') {
    pendingActivities.set(activity.id, command);
    return;
  }

  await executePrivileged(command, activity.id);
}

async function executePrivileged(command: AgentCommand, activityId: string): Promise<void> {
  try {
    let result: unknown;
    if (command.type === 'tab/navigate') {
      const tab = await resolveTab(command.tabId);
      const url = safeUrl(command.url);
      if (!url) throw new Error('Only http(s) navigation is allowed.');
      result = await chrome.tabs.update(tab.id, { url });
    } else if (command.type === 'page/highlight') {
      const tab = await resolveTab(command.tabId);
      result = await sendContentMessage(tab.id, { type: 'highlight', selector: command.selector, text: command.text });
    } else if (command.type === 'page/click') {
      const tab = await resolveTab(command.tabId);
      result = await sendContentMessage(tab.id, { type: 'click', selector: command.selector, text: command.text });
    } else if (command.type === 'page/type') {
      const tab = await resolveTab(command.tabId);
      result = await sendContentMessage(tab.id, { type: 'type', selector: command.selector, text: command.text });
    }
    updateActivity(activityId, 'completed');
    sendAgentResult(command.id, result ?? { ok: true });
  } catch (error) {
    updateActivity(activityId, 'failed');
    sendAgentResult(command.id, null, error instanceof Error ? error.message : String(error));
  }
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

async function resolveTab(tabId?: number): Promise<BrowserTabSummary> {
  const tab = tabId ? summarizeTab(await chrome.tabs.get(tabId)) : await getActiveTab();
  if (!tab?.id) throw new Error('No active tab is available.');
  if (isExtensionPage(tab.url)) throw new Error('Chrome internal and extension pages cannot be controlled.');
  return tab;
}

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

async function addChat(author: ChatMessage['author'], text: string): Promise<ChatMessage> {
  const message: ChatMessage = { id: createId('chat'), author, text, createdAt: now() };
  chat = [...chat, message].slice(-200);
  await saveChat(chat);
  void chrome.runtime.sendMessage({ type: 'chat', message }).catch(() => undefined);
  sendToAgent({ type: 'chat', message });
  return message;
}

chrome.runtime.onMessage.addListener((command: UiCommand, _sender, sendResponse: (response: UiResponse) => void) => {
  void (async () => {
    try {
      if (command.type === 'getState') sendResponse({ ok: true, data: state });
      else if (command.type === 'getChat') sendResponse({ ok: true, data: chat });
      else if (command.type === 'getOutputs') sendResponse({ ok: true, data: outputs });
      else if (command.type === 'connect') {
        settings = { ...settings, ...(command.settings ?? {}), autoConnect: true };
        await saveSettings(settings);
        connect();
        sendResponse({ ok: true, data: state });
      } else if (command.type === 'disconnect') {
        disconnect();
        sendResponse({ ok: true, data: state });
      } else if (command.type === 'sendChat') {
        sendResponse({ ok: true, data: await addChat('user', command.text) });
      } else if (command.type === 'updateSettings') {
        settings = { ...settings, ...command.settings };
        await saveSettings(settings);
        state = { ...state, endpoint: settings.endpoint, tokenPreview: tokenPreview(settings.token), controlMode: settings.controlMode };
        publishState();
        sendResponse({ ok: true, data: state });
      } else if (command.type === 'approveActivity') {
        const pending = pendingActivities.get(command.id);
        if (!pending) throw new Error('Activity not found.');
        pendingActivities.delete(command.id);
        await executePrivileged(pending, command.id);
        sendResponse({ ok: true, data: state });
      } else if (command.type === 'rejectActivity') {
        const pending = pendingActivities.get(command.id);
        pendingActivities.delete(command.id);
        updateActivity(command.id, 'rejected');
        sendAgentResult(pending?.id, null, 'Rejected by user.');
        sendResponse({ ok: true, data: state });
      }
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  })();
  return true;
});

chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
void init();

