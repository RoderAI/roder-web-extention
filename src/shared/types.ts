/// <reference types="chrome" />

export type BridgeStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type ControlMode = 'observe' | 'assist' | 'control';

export interface BridgeSettings {
  endpoint: string;
  token: string;
  autoConnect: boolean;
  controlMode: ControlMode;
  allowPageInspection: boolean;
  allowNavigation: boolean;
  allowInput: boolean;
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
}

export interface BrowserTabSummary {
  id: number;
  windowId: number;
  title?: string;
  url?: string;
  favIconUrl?: string;
  active: boolean;
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
  kind: 'connection' | 'tab' | 'activity' | 'snapshot' | 'error' | 'command';
  title: string;
  detail?: string;
  createdAt: number;
  status?: AgentActivity['status'];
  activityId?: string;
}

export type UiCommand =
  | { type: 'connect'; settings?: Partial<BridgeSettings> }
  | { type: 'disconnect' }
  | { type: 'getState' }
  | { type: 'getChat' }
  | { type: 'getOutputs' }
  | { type: 'sendChat'; text: string }
  | { type: 'updateSettings'; settings: Partial<BridgeSettings> }
  | { type: 'approveActivity'; id: string }
  | { type: 'rejectActivity'; id: string };

export type UiResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type BridgeEvent =
  | { type: 'hello'; source: 'roder-chrome'; version: string; capabilities: string[] }
  | { type: 'state'; state: BridgeState }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'output'; output: OutputEvent }
  | { type: 'tabs/list'; tabs: BrowserTabSummary[] }
  | { type: 'tab/updated'; tab: BrowserTabSummary }
  | { type: 'page/snapshot'; tab: BrowserTabSummary; snapshot: PageSnapshot }
  | { type: 'activity'; activity: AgentActivity };

export type AgentCommand =
  | { type: 'chat'; id?: string; text: string }
  | { type: 'tabs/list'; id?: string }
  | { type: 'tab/activate'; id?: string; tabId: number }
  | { type: 'tab/navigate'; id?: string; tabId?: number; url: string }
  | { type: 'page/snapshot'; id?: string; tabId?: number }
  | { type: 'page/highlight'; id?: string; tabId?: number; selector?: string; text?: string }
  | { type: 'page/click'; id?: string; tabId?: number; selector?: string; text?: string }
  | { type: 'page/type'; id?: string; tabId?: number; selector?: string; text: string };

export interface PageSnapshot {
  title: string;
  url: string;
  text: string;
  controls: PageControl[];
  capturedAt: number;
}

export interface PageControl {
  tag: string;
  text: string;
  ariaLabel?: string;
  name?: string;
  id?: string;
  href?: string;
  selector: string;
}

export const defaultSettings: BridgeSettings = {
  endpoint: 'ws://127.0.0.1:0',
  token: '',
  autoConnect: false,
  controlMode: 'assist',
  allowPageInspection: true,
  allowNavigation: false,
  allowInput: false,
};

export const storageKeys = {
  settings: 'roderChrome.settings',
  chat: 'roderChrome.chat',
  outputs: 'roderChrome.outputs',
} as const;
