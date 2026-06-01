import { Bot, ExternalLink, MessageSquare, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import '../shared/styles.css';
import { StatusBadge } from '../shared/StatusBadge';
import { useBridge } from '../shared/useBridge';

function PopupApp() {
  const { state, settings, chat, outputs, error, connect, disconnect, sendChat } = useBridge();
  const [text, setText] = useState('');
  const isConnected = state?.status === 'connected';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    await sendChat(text.trim());
    setText('');
  }

  if (isConnected) {
    return (
      <main className="live-shell" style={{ width: 420, height: 600 }}>
        <header className="live-topbar">
          <div className="live-title-row">
            <div className="live-title"><Bot size={18} /> Roder live</div>
            <button className="btn danger" onClick={() => void disconnect()}>Disconnect</button>
          </div>
          <div className="small truncate"><StatusBadge status={state.status} /> {settings?.controlMode ?? state.controlMode} · {state.activeTab?.title ?? 'No tab'}</div>
        </header>
        <section className="live-main" style={{ gridTemplateColumns: '1fr' }}>
          <div className="live-chat">
            {chat.slice(-20).map((message) => (
              <article key={message.id} className={`live-message ${message.author}`}>
                <div className="live-message-meta">{message.author} · {new Date(message.createdAt).toLocaleTimeString()}</div>
                <div>{message.text}</div>
              </article>
            ))}
            {chat.length === 0 ? <div className="empty-state">Connected. Chat will appear here.</div> : null}
          </div>
        </section>
        <form className="live-composer" onSubmit={(event) => void submit(event)}>
          <textarea rows={1} value={text} onChange={(event) => setText(event.target.value)} placeholder={`${outputs.length} output events · message agent...`} />
          <button className="btn primary" type="submit">Send</button>
        </form>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="panel">
        <header className="header">
          <div className="logo"><Bot size={22} /></div>
          <div>
            <h1>Roder Browser Bridge</h1>
            <p>Connect to open the full-screen chat console</p>
          </div>
        </header>
        <div className="content">
          <div className="status-row">
            <div>
              <div className="small">Bridge status</div>
              <StatusBadge status={state?.status ?? 'disconnected'} />
            </div>
            <button className="btn primary" onClick={() => void connect()}>Connect</button>
          </div>

          {error || state?.lastError ? <div className="error-text">{error ?? state?.lastError}</div> : null}

          <div className="tab-card">
            <div className="small">Active tab</div>
            <strong className="truncate">{state?.activeTab?.title ?? 'No active tab'}</strong>
            <div className="small truncate">{state?.activeTab?.url}</div>
          </div>

          <div className="actions">
            <button className="btn ghost" onClick={() => chrome.runtime.openOptionsPage()}><ShieldCheck size={15} /> Settings</button>
            <button className="btn ghost" onClick={() => { if (state?.activeTab?.windowId !== undefined) void chrome.sidePanel?.open({ windowId: state.activeTab.windowId }); }}><MessageSquare size={15} /> Full chat</button>
          </div>

          <div className="small">{chat.length} messages · endpoint <span className="mono">{state?.endpoint}</span></div>
          <a className="small" href="sidepanel.html" target="_blank" rel="noreferrer"><ExternalLink size={12} /> Open full panel</a>
        </div>
      </section>
    </main>
  );
}

export default PopupApp;
