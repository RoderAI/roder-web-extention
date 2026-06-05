import { Film, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Recording } from '../shared/types';
import { getRecordings } from '../shared/extension-client';

export function RecordingsPanel() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setRecordings(await getRecordings());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 4000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="panel-section">
      <div className="section-title">
        <span><Film size={13} /> Recordings</span>
        <button className="btn ghost icon" title="Refresh" onClick={() => void refresh()}><RefreshCw size={13} /></button>
      </div>
      {error ? <div className="error-text">{error}</div> : null}
      {recordings.length === 0 ? <div className="small">No recordings yet. Action traces appear here once started.</div> : null}
      {recordings.map((r) => (
        <div key={r.id} className="perm-card">
          <div className="perm-card-head">
            <span className="mono truncate">{r.id}</span>
            <span className={`badge ${r.stoppedAt ? 'disconnected' : 'connecting'}`}>{r.stoppedAt ? 'stopped' : 'recording'}</span>
          </div>
          <div className="small">{r.actions.length} actions · started {new Date(r.startedAt).toLocaleTimeString()}{r.tabId ? ` · tab ${r.tabId}` : ''}</div>
          {r.note ? <div className="small mono">{r.note}</div> : null}
        </div>
      ))}
    </div>
  );
}
