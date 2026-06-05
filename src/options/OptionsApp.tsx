import { Save, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import '../shared/styles.css';
import type { BridgeSettings, ControlMode } from '../shared/types';
import { defaultSettings } from '../shared/types';
import { getSettings, sendCommand } from '../shared/extension-client';
import { PermissionsPanel } from '../sidepanel/PermissionsPanel';

function OptionsApp() {
  const [settings, setSettings] = useState<BridgeSettings>(defaultSettings);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getSettings().then(setSettings).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  function patch(update: Partial<BridgeSettings>) {
    setSettings((current) => ({ ...current, ...update }));
    setSaved(false);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    try {
      await sendCommand({ type: 'updateSettings', settings });
      setSaved(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="app-shell">
      <section className="panel">
        <header className="header">
          <div className="logo"><ShieldCheck size={22} /></div>
          <div>
            <h1>Roder Chrome Settings</h1>
            <p>Pair with Roder /remote and choose what agents can do</p>
          </div>
        </header>
        <form className="content" onSubmit={(event) => void save(event)}>
          <label>
            WebSocket endpoint
            <input value={settings.endpoint} onChange={(event) => patch({ endpoint: event.target.value })} placeholder="ws://127.0.0.1:12345" />
          </label>
          <label>
            Bearer token
            <input type="password" value={settings.token} onChange={(event) => patch({ token: event.target.value })} placeholder="Paste token from /remote pairing" />
          </label>
          <label>
            Control mode
            <select value={settings.controlMode} onChange={(event) => patch({ controlMode: event.target.value as ControlMode })}>
              <option value="observe">Observe: chat and tab status only</option>
              <option value="assist">Assist: ask before privileged actions</option>
              <option value="control">Control: run enabled actions immediately</option>
            </select>
          </label>

          <h2 className="section-title">Capabilities</h2>
          <label className="setting-row toggle">
            Auto-connect when Chrome starts
            <input type="checkbox" checked={settings.autoConnect} onChange={(event) => patch({ autoConnect: event.target.checked })} />
          </label>
          <label className="setting-row toggle">
            Allow page snapshots, screenshots, and element highlights
            <input type="checkbox" checked={settings.allowPageInspection} onChange={(event) => patch({ allowPageInspection: event.target.checked })} />
          </label>
          <label className="setting-row toggle">
            Allow agent-requested navigation
            <input type="checkbox" checked={settings.allowNavigation} onChange={(event) => patch({ allowNavigation: event.target.checked })} />
          </label>
          <label className="setting-row toggle">
            Allow clicking, typing, scrolling when mode is Control
            <input type="checkbox" checked={settings.allowInput} onChange={(event) => patch({ allowInput: event.target.checked })} />
          </label>
          <label className="setting-row toggle">
            Allow JavaScript evaluation (Control mode + per-site eval permission)
            <input type="checkbox" checked={settings.allowEval} onChange={(event) => patch({ allowEval: event.target.checked })} />
          </label>
          <label className="setting-row toggle">
            Allow debugger attach (console + network capture)
            <input type="checkbox" checked={settings.allowDebugger} onChange={(event) => patch({ allowDebugger: event.target.checked })} />
          </label>
          <label className="setting-row toggle">
            Allow downloads
            <input type="checkbox" checked={settings.allowDownload} onChange={(event) => patch({ allowDownload: event.target.checked })} />
          </label>
          <label className="setting-row toggle">
            Allow uploads (user-mediated)
            <input type="checkbox" checked={settings.allowUpload} onChange={(event) => patch({ allowUpload: event.target.checked })} />
          </label>
          <label className="setting-row toggle">
            Allow action-trace recording
            <input type="checkbox" checked={settings.allowRecording} onChange={(event) => patch({ allowRecording: event.target.checked })} />
          </label>

          <p className="small">Security note: privileged actions also require a matching per-site permission below. Use ws://127.0.0.1 or a trusted private network only. Tokens are stored in Chrome local extension storage.</p>
          {error ? <div className="error-text">{error}</div> : null}
          {saved ? <div className="small">Settings saved.</div> : null}
          <button className="btn primary" type="submit"><Save size={16} /> Save settings</button>
        </form>

        <div className="content">
          <PermissionsPanel />
        </div>
      </section>
    </main>
  );
}

export default OptionsApp;
