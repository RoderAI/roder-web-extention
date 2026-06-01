import type { BridgeSettings, BridgeState, ChatMessage, OutputEvent, UiCommand, UiResponse } from './types';
import { defaultSettings } from './types';

export async function sendCommand<T>(command: UiCommand): Promise<T> {
  const response = (await chrome.runtime.sendMessage(command)) as UiResponse<T>;
  if (!response?.ok) throw new Error(response?.error ?? 'Extension background did not respond.');
  return response.data;
}

export async function getState(): Promise<BridgeState> {
  return sendCommand<BridgeState>({ type: 'getState' });
}

export async function getChat(): Promise<ChatMessage[]> {
  return sendCommand<ChatMessage[]>({ type: 'getChat' });
}

export async function getOutputs(): Promise<OutputEvent[]> {
  return sendCommand<OutputEvent[]>({ type: 'getOutputs' });
}

export async function getSettings(): Promise<BridgeSettings> {
  const stored = await chrome.storage.local.get('roderChrome.settings');
  return { ...defaultSettings, ...(stored['roderChrome.settings'] ?? {}) };
}
