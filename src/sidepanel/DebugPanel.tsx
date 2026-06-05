import { Network, RefreshCw, Terminal } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DebugSummary } from '../shared/types';
import { getDebug } from '../shared/extension-client';

export function DebugPanel({ tabId }: { tabId?: number }) {
  const [debug, setDebug] = useState<DebugSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setDebug(await getDebug(tabId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  const console = debug?.console ?? [];
  const network = debug?.network ?? [];

  return (
    <div className="panel-section">
      <div className="section-title">
        <span><Terminal size={13} /> Console ({console.length})</span>
        <button className="btn ghost icon" title="Refresh" onClick={() => void refresh()}><RefreshCw size={13} /></button>
      </div>
      {error ? <div className="error-text">{error}</div> : null}
      {console.length === 0 ? <div className="small">No console entries. Attach the debugger to a tab to capture them.</div> : null}
      <div className="debug-list">
        {console.slice(-40).reverse().map((entry, i) => (
          <div key={i} className={`debug-row ${entry.level}`}>
            <span className="debug-level">{entry.level}</span>
            <span className="mono truncate">{entry.text}</span>
          </div>
        ))}
      </div>

      <div className="section-title"><Network size={13} /> Network ({network.length})</div>
      <div className="debug-list">
        {network.slice(-40).reverse().map((entry) => (
          <div key={entry.requestId} className={`debug-row ${entry.failed ? 'error' : ''}`}>
            <span className="debug-level">{entry.method ?? '?'} {entry.status ?? (entry.failed ? 'FAIL' : '...')}</span>
            <span className="mono truncate">{entry.url}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
