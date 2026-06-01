import type { BridgeSettings, ChatMessage, OutputEvent } from './types';
import { defaultSettings, storageKeys } from './types';

export async function loadSettings(): Promise<BridgeSettings> {
  const stored = await chrome.storage.local.get(storageKeys.settings);
  return { ...defaultSettings, ...(stored[storageKeys.settings] ?? {}) };
}

export async function saveSettings(settings: BridgeSettings): Promise<void> {
  await chrome.storage.local.set({ [storageKeys.settings]: settings });
}

export async function loadChat(): Promise<ChatMessage[]> {
  const stored = await chrome.storage.local.get(storageKeys.chat);
  const value = stored[storageKeys.chat];
  return Array.isArray(value) ? (value as ChatMessage[]) : [];
}

export async function saveChat(messages: ChatMessage[]): Promise<void> {
  await chrome.storage.local.set({ [storageKeys.chat]: messages.slice(-200) });
}

export async function loadOutputs(): Promise<OutputEvent[]> {
  const stored = await chrome.storage.local.get(storageKeys.outputs);
  const value = stored[storageKeys.outputs];
  return Array.isArray(value) ? (value as OutputEvent[]) : [];
}

export async function saveOutputs(outputs: OutputEvent[]): Promise<void> {
  await chrome.storage.local.set({ [storageKeys.outputs]: outputs.slice(-300) });
}
