import { describe, expect, it } from 'vitest';
import { makeCommandResult, makeHello, parseAgentCommand } from '../src/shared/protocol';

describe('parseAgentCommand', () => {
  it('parses native envelope from a JSON string', () => {
    const cmd = parseAgentCommand(JSON.stringify({ type: 'tab/navigate', id: '7', url: 'https://x.com' }));
    expect(cmd).toEqual({ type: 'tab/navigate', id: '7', url: 'https://x.com' });
  });

  it('parses native envelope from an object', () => {
    const cmd = parseAgentCommand({ type: 'tabs/list', id: 3 });
    expect(cmd).toEqual({ type: 'tabs/list', id: '3' });
  });

  it('maps JSON-RPC method/params into the native shape', () => {
    const cmd = parseAgentCommand({ id: 'abc', method: 'page/click', params: { selector: '#go', text: 'Go' } });
    expect(cmd).toEqual({ type: 'page/click', id: 'abc', selector: '#go', text: 'Go' });
  });

  it('handles JSON-RPC with no params', () => {
    const cmd = parseAgentCommand({ id: 1, method: 'tabs/list' });
    expect(cmd).toEqual({ type: 'tabs/list', id: '1' });
  });

  it('returns null for invalid JSON', () => {
    expect(parseAgentCommand('{not json')).toBeNull();
  });

  it('returns null for payloads without type or method', () => {
    expect(parseAgentCommand({ foo: 'bar' })).toBeNull();
    expect(parseAgentCommand(42)).toBeNull();
    expect(parseAgentCommand(null)).toBeNull();
  });

  it('round-trips a serialized command', () => {
    const original = { type: 'page/type' as const, id: 'x', selector: '#a', text: 'hi', submit: true };
    const round = parseAgentCommand(JSON.stringify(original));
    expect(round).toEqual(original);
  });
});

describe('makeCommandResult', () => {
  it('builds the canonical envelope', () => {
    expect(makeCommandResult('9', true, { ok: 1 })).toEqual({ type: 'command/result', id: '9', ok: true, result: { ok: 1 }, error: undefined });
  });
  it('returns null when id is missing', () => {
    expect(makeCommandResult(undefined, false, undefined, 'nope')).toBeNull();
  });
  it('carries error on failure', () => {
    const r = makeCommandResult('2', false, undefined, 'boom');
    expect(r).toMatchObject({ ok: false, error: 'boom', id: '2' });
  });
});

describe('makeHello', () => {
  it('builds the hello event with source and capabilities', () => {
    const hello = makeHello('0.2.0', ['chat', 'tabs.list']);
    expect(hello).toEqual({ type: 'hello', source: 'roder-chrome', version: '0.2.0', capabilities: ['chat', 'tabs.list'] });
  });
});
