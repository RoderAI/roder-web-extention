/// <reference types="chrome" />

// types.ts now re-exports the typed wire protocol from protocol.ts so existing
// imports (`from '../shared/types'`) keep working unchanged. New code may import
// directly from protocol.ts.
export * from './protocol';
