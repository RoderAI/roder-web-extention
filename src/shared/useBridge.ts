import { useCallback, useEffect, useState } from 'react';
import type { BridgeEvent, BridgeSettings, BridgeState, ChatMessage, OutputEvent } from './types';
import { getChat, getOutputs, getSettings, getState, sendCommand } from './extension-client';

export function useBridge() {
  const [state, setState] = useState<BridgeState | null>(null);
  const [settings, setSettings] = useState<BridgeSettings | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [outputs, setOutputs] = useState<OutputEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextState, nextSettings, nextChat, nextOutputs] = await Promise.all([getState(), getSettings(), getChat(), getOutputs()]);
      setState(nextState);
      setSettings(nextSettings);
      setChat(nextChat);
      setOutputs(nextOutputs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const listener = (event: BridgeEvent) => {
      if (event.type === 'state') setState(event.state);
      if (event.type === 'chat') setChat((current) => [...current, event.message].slice(-200));
      if (event.type === 'output') setOutputs((current) => [...current, event.output].slice(-300));
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refresh]);

  const saveSettings = useCallback(async (patch: Partial<BridgeSettings>) => {
    const nextState = await sendCommand<BridgeState>({ type: 'updateSettings', settings: patch });
    setState(nextState);
    setSettings((current) => ({ ...(current ?? nextState), ...patch } as BridgeSettings));
  }, []);

  const connect = useCallback(async (patch?: Partial<BridgeSettings>) => {
    const nextState = await sendCommand<BridgeState>({ type: 'connect', settings: patch });
    setState(nextState);
    await refresh();
  }, [refresh]);

  const disconnect = useCallback(async () => {
    const nextState = await sendCommand<BridgeState>({ type: 'disconnect' });
    setState(nextState);
    await refresh();
  }, [refresh]);

  const sendChat = useCallback(async (text: string) => {
    const message = await sendCommand<ChatMessage>({ type: 'sendChat', text });
    setChat((current) => [...current, message].slice(-200));
  }, []);

  const approve = useCallback(async (id: string) => {
    await sendCommand<BridgeState>({ type: 'approveActivity', id });
  }, []);

  const reject = useCallback(async (id: string) => {
    await sendCommand<BridgeState>({ type: 'rejectActivity', id });
  }, []);

  return { state, settings, chat, outputs, error, refresh, saveSettings, connect, disconnect, sendChat, approve, reject };
}
