/// <reference types="chrome" />

// =============================================================================
// Redaction & untrusted-content labeling.
//
// Anything derived from a page, the DOM, the console, or the network is
// attacker-controllable and must (a) never leak secrets back to gode and
// (b) be tagged `untrusted: true` so the model layer treats it as data, not
// instructions.
// =============================================================================

import type { ConsoleEntry, NetworkEntry } from './protocol';

/** Header names that must never be transmitted (case-insensitive). */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-xsrf-token',
  'api-key',
]);

/** Query-string param names whose presence usually signals a secret. */
const SENSITIVE_QUERY_KEYS = [
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'api_key',
  'apikey',
  'key',
  'secret',
  'password',
  'passwd',
  'pwd',
  'auth',
  'session',
  'sig',
  'signature',
  'code',
];

/** Input element types whose values must never be captured. */
const SENSITIVE_INPUT_TYPES = new Set(['password', 'hidden']);

/** Input `name`/`autocomplete`/`id` substrings that signal a secret value. */
const SENSITIVE_INPUT_HINTS = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'otp',
  'cvc',
  'cvv',
  'ssn',
  'card',
  'cc-number',
  'cardnumber',
  'pin',
];

export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADERS.has(name.trim().toLowerCase());
}

/**
 * Strip query string and fragment from a URL. We keep origin + pathname only,
 * which is enough for the model to reason about a request without leaking
 * tokens that frequently ride in query params.
 */
export function stripUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    // Not a parseable absolute URL — best-effort: cut at ? or #.
    return rawUrl.split(/[?#]/)[0] ?? rawUrl;
  }
}

/**
 * Returns true if a URL's query string appears to carry a secret. Used only for
 * logging/diagnostics; the URL is stripped regardless before transmission.
 */
export function urlHasSensitiveQuery(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_QUERY_KEYS.includes(key.toLowerCase())) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Drop sensitive headers, returning only safe metadata header names+values. */
export function redactHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const safe: Record<string, string> = {};
  if (!headers) return safe;
  for (const [name, value] of Object.entries(headers)) {
    if (isSensitiveHeader(name)) continue;
    safe[name] = value;
  }
  return safe;
}

/**
 * Should this input element's value be captured at all? Password, hidden, and
 * heuristically-secret fields are never captured.
 */
export function isSensitiveField(opts: {
  type?: string | null;
  name?: string | null;
  id?: string | null;
  autocomplete?: string | null;
}): boolean {
  const type = (opts.type ?? '').toLowerCase();
  if (SENSITIVE_INPUT_TYPES.has(type)) return true;
  const haystack = `${opts.name ?? ''} ${opts.id ?? ''} ${opts.autocomplete ?? ''}`.toLowerCase();
  return SENSITIVE_INPUT_HINTS.some((hint) => haystack.includes(hint));
}

/**
 * Return a safe value for a field, or undefined if the field is sensitive.
 * Long values are truncated.
 */
export function safeFieldValue(
  value: string | undefined,
  opts: { type?: string | null; name?: string | null; id?: string | null; autocomplete?: string | null },
  maxLen = 200,
): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (isSensitiveField(opts)) return undefined;
  return value.slice(0, maxLen);
}

/** Tag an arbitrary object as untrusted (mutates a shallow copy). */
export function markUntrusted<T extends object>(value: T): T & { untrusted: true } {
  return { ...value, untrusted: true };
}

/** Build a redacted console entry. */
export function redactConsoleEntry(input: {
  level: string;
  text: string;
  url?: string;
  line?: number;
  at?: number;
}): ConsoleEntry {
  return {
    level: input.level,
    text: (input.text ?? '').slice(0, 4000),
    url: input.url ? stripUrl(input.url) : undefined,
    line: input.line,
    at: input.at ?? Date.now(),
    untrusted: true,
  };
}

/** Build a redacted network entry from CDP-derived metadata (no bodies/headers). */
export function redactNetworkEntry(input: {
  requestId: string;
  method?: string;
  url: string;
  status?: number;
  resourceType?: string;
  requestSize?: number;
  responseSize?: number;
  startedAt?: number;
  finishedAt?: number;
  failed?: boolean;
  errorText?: string;
}): NetworkEntry {
  const startedAt = input.startedAt ?? Date.now();
  const finishedAt = input.finishedAt;
  return {
    requestId: input.requestId,
    method: input.method,
    url: stripUrl(input.url),
    status: input.status,
    resourceType: input.resourceType,
    requestSize: input.requestSize,
    responseSize: input.responseSize,
    startedAt,
    finishedAt,
    durationMs: finishedAt ? Math.max(0, finishedAt - startedAt) : undefined,
    failed: input.failed,
    errorText: input.errorText ? input.errorText.slice(0, 200) : undefined,
    untrusted: true,
  };
}
