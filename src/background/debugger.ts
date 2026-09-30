/// <reference types="chrome" />

// =============================================================================
// chrome.debugger integration: attach/detach + bounded console & network ring
// buffers per tab using the Chrome DevTools Protocol.
//
// We capture METADATA ONLY — no request/response bodies, no headers beyond what
// is needed for sizing, and all URLs are stripped of query strings before they
// leave this module (via redaction helpers). Entries are tagged `untrusted`.
// =============================================================================

import type { ConsoleEntry, NetworkEntry } from '../shared/protocol';
import { checkPermission, originOf } from './permissions';
import { redactConsoleEntry, redactNetworkEntry } from '../shared/redaction';

const PROTOCOL_VERSION = '1.3';
const RING_LIMIT = 200;

interface TabBuffers {
  console: ConsoleEntry[];
  network: NetworkEntry[];
  // in-flight requests keyed by CDP requestId, holding partial metadata
  pending: Map<string, Partial<NetworkEntry> & { url: string; requestId: string; startedAt: number }>;
}

type StreamHandler = (event: { type: 'debug/console'; tabId: number; entry: ConsoleEntry } | { type: 'debug/network'; tabId: number; entry: NetworkEntry }) => void;

const buffers = new Map<number, TabBuffers>();
const attached = new Set<number>();
const origins = new Map<number,string>();
let streamHandler: StreamHandler | null = null;
let eventListenerInstalled = false;
let detachListenerInstalled = false;

function getBuffers(tabId: number): TabBuffers {
  let entry = buffers.get(tabId);
  if (!entry) {
    entry = { console: [], network: [], pending: new Map() };
    buffers.set(tabId, entry);
  }
  return entry;
}

function pushRing<T>(ring: T[], item: T): void {
  ring.push(item);
  if (ring.length > RING_LIMIT) ring.splice(0, ring.length - RING_LIMIT);
}

/** Register the callback used to stream new console/network entries to gode. */
export function onDebugStream(handler: StreamHandler): void {
  streamHandler = handler;
}

/** Currently attached tab ids. */
export function attachedTabs(): number[] {
  return Array.from(attached);
}

export function isAttached(tabId: number): boolean {
  return attached.has(tabId);
}

function installDetachListener(): void {
  if (detachListenerInstalled) return;
  detachListenerInstalled = true;
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId !== undefined) {
      attached.delete(source.tabId);
      origins.delete(source.tabId);
      buffers.delete(source.tabId);
    }
  });
}

function installEventListener(): void {
  if (eventListenerInstalled) return;
  eventListenerInstalled = true;
  chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = source.tabId;
    if (tabId === undefined || !attached.has(tabId)) return;
    void (async()=>{
      const tab=await chrome.tabs.get(tabId);
      if (originOf(tab.url)!==origins.get(tabId) || !(await checkPermission(tab.url,'debugger'))) { await detach(tabId); return; }
      handleCdpEvent(tabId, method, (params ?? {}) as Record<string, unknown>);
    })().catch(()=>{});
  });
}

function handleCdpEvent(tabId: number, method: string, params: Record<string, unknown>): void {
  const buf = getBuffers(tabId);

  if (method === 'Runtime.consoleAPICalled') {
    const type = String(params.type ?? 'log');
    const args = Array.isArray(params.args) ? (params.args as Array<Record<string, unknown>>) : [];
    const text = args
      .map((a) => (a.value !== undefined ? String(a.value) : a.description !== undefined ? String(a.description) : a.type ? `[${String(a.type)}]` : ''))
      .join(' ')
      .trim();
    const entry = redactConsoleEntry({ level: type, text });
    pushRing(buf.console, entry);
    streamHandler?.({ type: 'debug/console', tabId, entry });
    return;
  }

  if (method === 'Log.entryAdded') {
    const e = (params.entry ?? {}) as Record<string, unknown>;
    const entry = redactConsoleEntry({
      level: String(e.level ?? 'info'),
      text: String(e.text ?? ''),
      url: typeof e.url === 'string' ? e.url : undefined,
      line: typeof e.lineNumber === 'number' ? e.lineNumber : undefined,
    });
    pushRing(buf.console, entry);
    streamHandler?.({ type: 'debug/console', tabId, entry });
    return;
  }

  if (method === 'Runtime.exceptionThrown') {
    const details = (params.exceptionDetails ?? {}) as Record<string, unknown>;
    const text = String(details.text ?? 'Uncaught exception');
    const entry = redactConsoleEntry({ level: 'error', text, line: typeof details.lineNumber === 'number' ? details.lineNumber : undefined });
    pushRing(buf.console, entry);
    streamHandler?.({ type: 'debug/console', tabId, entry });
    return;
  }

  if (method === 'Network.requestWillBeSent') {
    const requestId = String(params.requestId ?? '');
    const request = (params.request ?? {}) as Record<string, unknown>;
    const url = String(request.url ?? '');
    if (!requestId || !url) return;
    buf.pending.set(requestId, {
      requestId,
      url,
      method: typeof request.method === 'string' ? request.method : undefined,
      resourceType: typeof params.type === 'string' ? params.type : undefined,
      startedAt: Date.now(),
    });
    return;
  }

  if (method === 'Network.responseReceived') {
    const requestId = String(params.requestId ?? '');
    const response = (params.response ?? {}) as Record<string, unknown>;
    const pending = buf.pending.get(requestId);
    if (!pending) return;
    pending.status = typeof response.status === 'number' ? response.status : undefined;
    if (typeof params.type === 'string') pending.resourceType = params.type;
    return;
  }

  if (method === 'Network.loadingFinished') {
    const requestId = String(params.requestId ?? '');
    const pending = buf.pending.get(requestId);
    if (!pending) return;
    buf.pending.delete(requestId);
    const entry = redactNetworkEntry({
      requestId: pending.requestId,
      method: pending.method,
      url: pending.url,
      status: pending.status,
      resourceType: pending.resourceType,
      responseSize: typeof params.encodedDataLength === 'number' ? params.encodedDataLength : undefined,
      startedAt: pending.startedAt,
      finishedAt: Date.now(),
    });
    pushRing(buf.network, entry);
    streamHandler?.({ type: 'debug/network', tabId, entry });
    return;
  }

  if (method === 'Network.loadingFailed') {
    const requestId = String(params.requestId ?? '');
    const pending = buf.pending.get(requestId);
    if (!pending) return;
    buf.pending.delete(requestId);
    const entry = redactNetworkEntry({
      requestId: pending.requestId,
      method: pending.method,
      url: pending.url,
      status: pending.status,
      resourceType: pending.resourceType,
      startedAt: pending.startedAt,
      finishedAt: Date.now(),
      failed: true,
      errorText: typeof params.errorText === 'string' ? params.errorText : 'Request failed',
    });
    pushRing(buf.network, entry);
    streamHandler?.({ type: 'debug/network', tabId, entry });
    return;
  }
}

function sendCommand(tabId: number, method: string, commandParams?: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, commandParams ?? {}, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result);
    });
  });
}

/** Attach the debugger to a tab and enable the relevant CDP domains. */
export async function attach(tabId: number): Promise<void> {
  const tab=await chrome.tabs.get(tabId);
  const origin=originOf(tab.url);
  if(!origin || !(await checkPermission(tab.url,'debugger'))) throw new Error('Debugger permission is missing for this site');
  origins.set(tabId,origin);
  installEventListener();
  installDetachListener();
  if (attached.has(tabId)) return;

  await new Promise<void>((resolve, reject) => {
    chrome.debugger.attach({ tabId }, PROTOCOL_VERSION, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
  attached.add(tabId);
  getBuffers(tabId);

  // Enable domains; tolerate individual failures so one missing domain doesn't
  // sink the whole attach.
  await Promise.allSettled([
    sendCommand(tabId, 'Runtime.enable'),
    sendCommand(tabId, 'Log.enable'),
    sendCommand(tabId, 'Network.enable'),
  ]);
}

/** Detach the debugger from a tab. */
export async function detach(tabId: number): Promise<void> {
  origins.delete(tabId);
  buffers.delete(tabId);
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  await new Promise<void>((resolve) => {
    chrome.debugger.detach({ tabId }, () => {
      // Ignore lastError on detach (tab may have closed).
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

/** Read the most recent console entries for a tab. */
export function readConsole(tabId: number, limit = RING_LIMIT): ConsoleEntry[] {
  const buf = buffers.get(tabId);
  if (!buf) return [];
  return buf.console.slice(-limit);
}

/** Read the most recent network entries for a tab. */
export function readNetwork(tabId: number, limit = RING_LIMIT): NetworkEntry[] {
  const buf = buffers.get(tabId);
  if (!buf) return [];
  return buf.network.slice(-limit);
}
