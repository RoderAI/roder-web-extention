import { Bot, Check, Plug, Send, Settings, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import '../shared/styles.css';
import { StatusBadge } from '../shared/StatusBadge';
import { useBridge } from '../shared/useBridge';

function SidePanelApp() {
  const { state, settings, chat, outputs, error, connect, disconnect, sendChat, approve, reject } = useBridge();
  const [text, setText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const activity = state?.lastAgentActivity;
  const isConnected = state?.status === 'connected';
  const visibleOutputs = useMemo(() => outputs.slice(-120).reverse(), [outputs]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.length]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    await sendChat(text.trim());
    setText('');
  }

  if (!isConnected) {
    return (
      <main className="live-shell">
        <header className="live-topbar">
          <div className="live-title-row">
            <div className="live-title truncate"><Plug size={18} /> Roder browser bridge</div>
            <div className="actions">
              <button className="btn ghost" onClick={() => chrome.runtime.openOptionsPage()}><Settings size={14} /></button>
              <button className="btn primary" onClick={() => void connect()}>Connect</button>
            </div>
          </div>
          <div className="live-meta-row small">
            <span><StatusBadge status={state?.status ?? 'disconnected'} /> not connected</span>
            <span className="mono truncate">{state?.endpoint}</span>
          </div>
        </header>

        <section className="live-main single">
          <div className="live-chat">
            <div className="empty-state">
              <Plug size={36} />
              <h2>Connect to Roder</h2>
              <p>Paste the WebSocket URL and token from Roder <span className="mono">/remote</span> in settings, then connect.</p>
              {error || state?.lastError ? <div className="error-text">{error ?? state?.lastError}</div> : null}
              <div className="actions" style={{ justifyContent: 'center' }}>
                <button className="btn ghost" onClick={() => chrome.runtime.openOptionsPage()}><Settings size={15} /> Settings</button>
                <button className="btn primary" onClick={() => void connect()}>Connect</button>
              </div>
            </div>
          </div>
        </section>

        <div className="live-composer disabled-composer">
          <textarea rows={1} disabled placeholder="Connect to start chatting with the coding agent..." />
          <button className="btn primary" disabled>Send</button>
        </div>
      </main>
    );
  }

  return (
    <main className="live-shell">
      <header className="live-topbar">
        <div className="live-title-row">
          <div className="live-title truncate"><Bot size={18} /> Roder live browser</div>
          <div className="actions">
            <button className="btn ghost" onClick={() => chrome.runtime.openOptionsPage()}><Settings size={14} /></button>
            <button className="btn danger" onClick={() => void disconnect()}>Disconnect</button>
          </div>
        </div>
        <div className="live-meta-row small">
          <span className="truncate"><StatusBadge status={state.status} /> {settings?.controlMode ?? state.controlMode} · {state.activeTab?.title ?? 'No active tab'}</span>
          <span className="mono truncate">{state.activeTab?.url ?? state.endpoint}</span>
        </div>
      </header>

      {activity?.status === 'pending' ? (
        <div className="pending-action">
          <div>
            <strong>{activity.label}</strong>
            <div className="small">{activity.kind} wants permission</div>
          </div>
          <div className="actions">
            <button className="btn primary" onClick={() => void approve(activity.id)}><Check size={15} /> Approve</button>
            <button className="btn danger" onClick={() => void reject(activity.id)}><X size={15} /> Reject</button>
          </div>
        </div>
      ) : null}

      <section className="live-main">
        <div className="live-chat">
          {chat.length === 0 ? (
            <div className="empty-state">
              <Bot size={32} />
              <h2>No chat yet</h2>
              <p>Messages from the agent and your replies will fill this full-screen space.</p>
            </div>
          ) : null}
          {chat.map((message) => (
            <article key={message.id} className={`live-message ${message.author}`}>
              <div className="live-message-meta">{message.author} · {new Date(message.createdAt).toLocaleTimeString()}</div>
              <div>{message.text}</div>
            </article>
          ))}
          <div ref={bottomRef} />
        </div>

        <aside className="live-output">
          <div className="output-header">Outputs</div>
          <div className="output-list">
            {visibleOutputs.length === 0 ? <div className="output-item"><div className="output-detail">No output events yet.</div></div> : null}
            {visibleOutputs.map((output) => (
              <article key={output.id} className={`output-item ${output.kind}`}>
                <div className="output-title">
                  <span>{output.title}</span>
                  <span>{output.status ?? output.kind}</span>
                </div>
                {output.detail ? <div className="output-detail mono">{output.detail}</div> : null}
                <div className="output-detail">{new Date(output.createdAt).toLocaleTimeString()}</div>
              </article>
            ))}
          </div>
        </aside>
      </section>

      <form className="live-composer" onSubmit={(event) => void submit(event)}>
        <textarea rows={1} value={text} onChange={(event) => setText(event.target.value)} placeholder="Chat with the coding agent..." />
        <button className="btn primary" type="submit"><Send size={16} /> Send</button>
      </form>
    </main>
  );
}

export default SidePanelApp;
