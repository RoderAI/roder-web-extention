/// <reference types="chrome" />

// =============================================================================
// 1-click auto-pairing content script.
//
// roder's app-server serves a `/pair` page whose URL fragment carries a
// base64url-encoded `{ endpoint, token }` payload. The token lives only in the
// fragment, so the server never sees it. When this script runs on that page it
// decodes the payload, validates the endpoint points at a loopback/private
// (LAN/Tailscale) WebSocket, then tells the background worker to configure and
// connect. It then strips the token from the visible URL and updates the page.
//
// Everything is wrapped in try/catch — a malformed or hostile fragment must
// never throw; we simply ignore it.
// =============================================================================

const PAIR_MARKER = 'roder-pair=';

/** Decode a base64url (no padding) string into a UTF-8 string. */
function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Only accept WebSocket endpoints that target a loopback or private-range host.
 * This prevents a pairing link from steering the extension at an arbitrary
 * remote server. Covers loopback, RFC1918 LAN ranges, and the Tailscale
 * 100.64.0.0/10 CGNAT range.
 */
function isAllowedEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return false;

  const host = url.hostname.toLowerCase();
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]') {
    return true;
  }
  if (host.startsWith('127.')) return true;
  if (host.startsWith('10.')) return true;
  if (host.startsWith('192.168.')) return true;

  // 172.16.0.0 – 172.31.255.255
  const private172 = host.match(/^172\.(\d{1,3})\./);
  if (private172) {
    const octet = Number(private172[1]);
    if (octet >= 16 && octet <= 31) return true;
  }

  // Tailscale CGNAT 100.64.0.0 – 100.127.255.255
  const tailscale = host.match(/^100\.(\d{1,3})\./);
  if (tailscale) {
    const octet = Number(tailscale[1]);
    if (octet >= 64 && octet <= 127) return true;
  }

  return false;
}

function markPaired(): void {
  const status = document.getElementById('roder-pair-status');
  if (status) {
    status.textContent = '✓ Paired with Roder — you can close this tab.';
  }
}

function autoPair(): void {
  try {
    const hash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
    if (!hash.includes(PAIR_MARKER)) return;

    // The marker may be one of several `&`-joined fragment params.
    const raw = hash
      .split('&')
      .map((part) => part.trim())
      .find((part) => part.startsWith(PAIR_MARKER));
    if (!raw) return;

    const encoded = raw.slice(PAIR_MARKER.length);
    if (!encoded) return;

    const decoded = base64UrlDecode(encoded);
    const payload = JSON.parse(decoded) as { endpoint?: unknown; token?: unknown };
    const endpoint = typeof payload.endpoint === 'string' ? payload.endpoint : '';
    const token = typeof payload.token === 'string' ? payload.token : '';
    if (!endpoint || !token) return;

    // Validate the endpoint before doing anything — silently ignore otherwise.
    if (!isAllowedEndpoint(endpoint)) return;

    chrome.runtime.sendMessage({
      type: 'updateSettings',
      settings: { endpoint, token, controlMode: 'assist' },
    });
    chrome.runtime.sendMessage({
      type: 'connect',
      settings: { endpoint, token },
    });

    markPaired();

    // Strip the token from the visible URL so it is not left in history/address bar.
    history.replaceState(null, '', location.pathname);
  } catch {
    // Never throw from a pairing attempt; a bad fragment is simply ignored.
  }
}

autoPair();
