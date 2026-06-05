import { describe, expect, it } from 'vitest';
import {
  isSensitiveField,
  isSensitiveHeader,
  redactConsoleEntry,
  redactHeaders,
  redactNetworkEntry,
  safeFieldValue,
  stripUrl,
  urlHasSensitiveQuery,
} from '../src/shared/redaction';

describe('stripUrl', () => {
  it('drops query string and fragment', () => {
    expect(stripUrl('https://x.com/path?token=abc#frag')).toBe('https://x.com/path');
  });
  it('keeps origin + pathname', () => {
    expect(stripUrl('https://api.example.com:8443/v1/users')).toBe('https://api.example.com:8443/v1/users');
  });
  it('best-effort for non-URLs', () => {
    expect(stripUrl('not a url?secret=1')).toBe('not a url');
  });
});

describe('urlHasSensitiveQuery', () => {
  it('detects token params', () => {
    expect(urlHasSensitiveQuery('https://x.com/?access_token=zzz')).toBe(true);
  });
  it('false for benign queries', () => {
    expect(urlHasSensitiveQuery('https://x.com/?page=2')).toBe(false);
  });
});

describe('isSensitiveHeader', () => {
  it('matches auth/cookie case-insensitively', () => {
    expect(isSensitiveHeader('Authorization')).toBe(true);
    expect(isSensitiveHeader('cookie')).toBe(true);
    expect(isSensitiveHeader('X-Api-Key')).toBe(true);
  });
  it('passes benign headers', () => {
    expect(isSensitiveHeader('Content-Type')).toBe(false);
  });
});

describe('redactHeaders', () => {
  it('drops sensitive headers and keeps the rest', () => {
    const safe = redactHeaders({ Authorization: 'Bearer x', 'Content-Type': 'application/json', Cookie: 'a=b' });
    expect(safe).toEqual({ 'Content-Type': 'application/json' });
  });
});

describe('isSensitiveField / safeFieldValue', () => {
  it('flags password and hidden inputs', () => {
    expect(isSensitiveField({ type: 'password' })).toBe(true);
    expect(isSensitiveField({ type: 'hidden' })).toBe(true);
  });
  it('flags by name heuristics', () => {
    expect(isSensitiveField({ type: 'text', name: 'user_token' })).toBe(true);
    expect(isSensitiveField({ type: 'text', name: 'email' })).toBe(false);
  });
  it('returns undefined for sensitive values, truncates otherwise', () => {
    expect(safeFieldValue('hunter2', { type: 'password' })).toBeUndefined();
    expect(safeFieldValue('hello', { type: 'text', name: 'q' })).toBe('hello');
    expect(safeFieldValue('x'.repeat(500), { type: 'text', name: 'q' }, 10)).toHaveLength(10);
  });
});

describe('redactConsoleEntry', () => {
  it('marks untrusted and strips url query', () => {
    const e = redactConsoleEntry({ level: 'error', text: 'boom', url: 'https://x.com/a?k=secret' });
    expect(e.untrusted).toBe(true);
    expect(e.url).toBe('https://x.com/a');
    expect(e.level).toBe('error');
  });
});

describe('redactNetworkEntry', () => {
  it('strips url, computes duration, marks untrusted', () => {
    const e = redactNetworkEntry({
      requestId: '1',
      method: 'GET',
      url: 'https://api.x.com/data?token=abc',
      status: 200,
      startedAt: 1000,
      finishedAt: 1250,
    });
    expect(e.url).toBe('https://api.x.com/data');
    expect(e.durationMs).toBe(250);
    expect(e.untrusted).toBe(true);
    // ensure no header/body fields leak through
    expect(e).not.toHaveProperty('headers');
    expect(e).not.toHaveProperty('body');
  });
});
