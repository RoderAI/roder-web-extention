/// <reference types="chrome" />

// =============================================================================
// Action-trace recorder.
//
// Records a timestamped trace of agent actions while a recording is active.
// GIF/video capture is not implemented in this MV3 build (would require an
// offscreen document driving captureVisibleTab on an interval); the trace is
// the deliverable and `note` documents the limitation.
// =============================================================================

import type { Recording, RecordedAction } from '../shared/protocol';
import { createId } from '../shared/utils';

const recordings = new Map<string, Recording>();
// tabId -> set of active recording ids capturing that tab
const activeByTab = new Map<number, Set<string>>();
const allActive = new Set<string>();

const TRACE_NOTE =
  'Action trace only. GIF/video capture is not supported in this MV3 build; ' +
  'each action is timestamped relative to recording start.';

/** Begin a recording, optionally scoped to a tab. Returns the recording. */
export function startRecording(tabId?: number): Recording {
  const recording: Recording = {
    id: createId('rec'),
    tabId,
    startedAt: Date.now(),
    actions: [],
    note: TRACE_NOTE,
  };
  recordings.set(recording.id, recording);
  allActive.add(recording.id);
  if (tabId !== undefined) {
    let set = activeByTab.get(tabId);
    if (!set) {
      set = new Set();
      activeByTab.set(tabId, set);
    }
    set.add(recording.id);
  }
  return recording;
}

/** Stop a recording and return its final trace. */
export function stopRecording(recordingId: string): Recording {
  const recording = recordings.get(recordingId);
  if (!recording) throw new Error(`Unknown recording: ${recordingId}`);
  recording.stoppedAt = Date.now();
  allActive.delete(recordingId);
  if (recording.tabId !== undefined) {
    activeByTab.get(recording.tabId)?.delete(recordingId);
  }
  return recording;
}

/**
 * Append an action to every active recording that should capture it. A recording
 * scoped to a tab only captures actions for that tab (or untargeted actions);
 * a global recording captures everything.
 */
export function recordAction(kind: string, tabId: number | undefined, detail?: Record<string, unknown>): void {
  if (allActive.size === 0) return;
  const action: RecordedAction = { at: Date.now(), kind, detail };
  for (const id of allActive) {
    const recording = recordings.get(id);
    if (!recording) continue;
    if (recording.tabId === undefined || tabId === undefined || recording.tabId === tabId) {
      const entry: RecordedAction = { ...action, at: action.at - recording.startedAt };
      recording.actions.push(entry);
    }
  }
}

/** Is any recording active right now? */
export function hasActiveRecording(): boolean {
  return allActive.size > 0;
}

/** List all recordings (active + finished), newest first. */
export function listRecordings(): Recording[] {
  return Array.from(recordings.values()).sort((a, b) => b.startedAt - a.startedAt);
}

export function getRecording(id: string): Recording | undefined {
  return recordings.get(id);
}
