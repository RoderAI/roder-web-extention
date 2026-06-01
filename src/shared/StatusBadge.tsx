import type { BridgeState } from './types';

export function StatusBadge({ status }: { status: BridgeState['status'] }) {
  return <span className={`badge ${status}`}>{status}</span>;
}
