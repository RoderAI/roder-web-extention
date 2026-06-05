/// <reference types="chrome" />

// Content-script message dispatcher. The heavy lifting lives in snapshot.ts and
// actions.ts; this file just wires chrome.runtime messages to those helpers.

import { captureSnapshot, getPageText } from './snapshot';
import { click, highlight, keypress, scroll, select, type } from './actions';

type Message =
  | { type: 'ping' }
  | { type: 'snapshot'; include?: import('../shared/protocol').SnapshotInclude[] }
  | { type: 'getText' }
  | { type: 'highlight'; selector?: string; text?: string; ref?: string }
  | { type: 'click'; selector?: string; text?: string; ref?: string }
  | { type: 'type'; selector?: string; ref?: string; text: string; submit?: boolean }
  | { type: 'keypress'; key: string }
  | { type: 'scroll'; selector?: string; dx?: number; dy?: number }
  | { type: 'select'; selector: string; value: string };

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  try {
    switch (message?.type) {
      case 'ping':
        sendResponse({ ok: true });
        return true;
      case 'snapshot':
        sendResponse({ ok: true, snapshot: captureSnapshot(message.include) });
        return true;
      case 'getText':
        sendResponse({ ok: true, text: getPageText() });
        return true;
      case 'highlight':
        sendResponse({ ok: true, ...highlight(message) });
        return true;
      case 'click':
        sendResponse({ ok: true, ...click(message) });
        return true;
      case 'type':
        sendResponse({ ok: true, ...type(message) });
        return true;
      case 'keypress':
        sendResponse({ ok: true, ...keypress(message.key) });
        return true;
      case 'scroll':
        sendResponse({ ok: true, ...scroll(message) });
        return true;
      case 'select':
        sendResponse({ ok: true, ...select(message) });
        return true;
      default:
        return false;
    }
  } catch (error) {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    return true;
  }
});
