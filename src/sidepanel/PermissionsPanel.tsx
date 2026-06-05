import { ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { OriginPermissionEntry, SitePermission } from '../shared/types';
import { getPermissionEntries, removePermission, setPermission } from '../shared/extension-client';

const PERM_LABELS: Array<{ key: SitePermission; label: string }> = [
  { key: 'inspect', label: 'Inspect' },
  { key: 'interact', label: 'Interact' },
  { key: 'eval', label: 'Eval' },
  { key: 'debugger', label: 'Debugger' },
  { key: 'download', label: 'Download' },
  { key: 'upload', label: 'Upload' },
  { key: 'recording', label: 'Recording' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'alwaysAllow', label: 'Always allow (skip approval)' },
];

export function PermissionsPanel({ activeOrigin }: { activeOrigin?: string }) {
  const [entries, setEntries] = useState<OriginPermissionEntry[]>([]);
  const [newOrigin, setNewOrigin] = useState(activeOrigin ?? '');
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setEntries(await getPermissionEntries());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (activeOrigin && !newOrigin) setNewOrigin(activeOrigin);
  }, [activeOrigin, newOrigin]);

  async function toggle(origin: string, key: SitePermission, value: boolean) {
    try {
      setEntries(await setPermission(origin, { [key]: value }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function addOrigin() {
    const trimmed = newOrigin.trim();
    if (!trimmed) return;
    try {
      // Normalize to an origin string.
      const origin = trimmed.includes('://') ? new URL(trimmed).origin : `https://${trimmed}`;
      setEntries(await setPermission(origin, {}));
      setNewOrigin('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function remove(origin: string) {
    try {
      setEntries(await removePermission(origin));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="panel-section">
      <div className="section-title"><ShieldCheck size={13} /> Site permissions</div>
      <div className="perm-add">
        <input
          value={newOrigin}
          placeholder={activeOrigin ?? 'https://example.com'}
          onChange={(e) => setNewOrigin(e.target.value)}
        />
        <button className="btn ghost" onClick={() => void addOrigin()}>Add</button>
      </div>
      {error ? <div className="error-text">{error}</div> : null}
      {entries.length === 0 ? <div className="small">No per-origin permissions configured. Defaults: inspect only.</div> : null}
      {entries.map((entry) => (
        <div key={entry.origin} className="perm-card">
          <div className="perm-card-head">
            <span className="mono truncate">{entry.origin}</span>
            <button className="btn ghost icon" title="Remove" onClick={() => void remove(entry.origin)}><Trash2 size={13} /></button>
          </div>
          <div className="perm-grid">
            {PERM_LABELS.map(({ key, label }) => (
              <label key={key} className="perm-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(entry.perms[key])}
                  onChange={(e) => void toggle(entry.origin, key, e.target.checked)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
