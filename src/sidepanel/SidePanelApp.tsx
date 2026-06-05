import { AlertTriangle, ArrowUp, Bot, Bug, Check, ChevronDown, ChevronRight, Film, MessageSquare, Plug, Settings, ShieldCheck, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import '../shared/styles.css';
import { StatusBadge } from '../shared/StatusBadge';
import { useBridge } from '../shared/useBridge';
import { PermissionsPanel } from './PermissionsPanel';
import { RecordingsPanel } from './RecordingsPanel';
import { DebugPanel } from './DebugPanel';

type Tab = 'chat' | 'permissions' | 'recordings' | 'debug';

function originOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function SidePanelApp() {
  const { state, settings, chat, outputs, error, connect, disconnect, sendChat, approve, reject } = useBridge();
  const [text, setText] = useState('');
  const [tab, setTab] = useState<Tab>('chat');
  const [showOutputs, setShowOutputs] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activity = state?.lastAgentActivity;
  const isConnected = state?.status === 'connected';
  const visibleOutputs = useMemo(() => outputs.slice(-120).reverse(), [outputs]);
  const troubles = state?.troubleshooting ?? [];
  const activeOrigin = originOf(state?.activeTab?.url);
  const controlMode = settings?.controlMode ?? state?.controlMode;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.length]);

  // Auto-grow the composer textarea up to a few lines.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    await sendChat(text.trim());
    setText('');
  }

  function onComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit(event);
    }
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

        <div className="composer-bar">
          <div className="composer-card disabled">
            <textarea rows={1} disabled placeholder="Connect to start chatting…" />
            <div className="composer-actions">
              <button className="composer-send" disabled aria-label="Send">
                <ArrowUp size={16} />
              </button>
            </div>
          </div>
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
        <nav className="tab-bar">
          <button className={`tab-btn ${tab === 'chat' ? 'active' : ''}`} onClick={() => setTab('chat')}><MessageSquare size={13} /> Chat</button>
          <button className={`tab-btn ${tab === 'permissions' ? 'active' : ''}`} onClick={() => setTab('permissions')}><ShieldCheck size={13} /> Sites</button>
          <button className={`tab-btn ${tab === 'recordings' ? 'active' : ''}`} onClick={() => setTab('recordings')}><Film size={13} /> Rec</button>
          <button className={`tab-btn ${tab === 'debug' ? 'active' : ''}`} onClick={() => setTab('debug')}><Bug size={13} /> Debug</button>
        </nav>
      </header>

      {troubles.length ? (
        <div className="trouble-banner">
          {troubles.map((t) => (
            <div key={t.kind} className="trouble-row"><AlertTriangle size={13} /> <span>{t.message}</span></div>
          ))}
        </div>
      ) : null}

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

      {tab === 'chat' ? (
        <section className="live-main single">
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
        </section>
      ) : (
        <section className="live-main single">
          <div className="live-chat scroll-panel">
            {tab === 'permissions' ? <PermissionsPanel activeOrigin={activeOrigin} /> : null}
            {tab === 'recordings' ? <RecordingsPanel /> : null}
            {tab === 'debug' ? <DebugPanel tabId={state.activeTab?.id} /> : null}
          </div>
        </section>
      )}

      {tab === 'chat' ? (
        <div className="composer-bar">
          <div className="outputs-region">
            <button
              type="button"
              className="outputs-toggle"
              aria-expanded={showOutputs}
              onClick={() => setShowOutputs((open) => !open)}
            >
              {showOutputs ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span>Outputs ({outputs.length})</span>
            </button>
            {showOutputs ? (
              <div className="outputs-list">
                {visibleOutputs.length === 0 ? (
                  <div className="output-item"><div className="output-detail">No output events yet.</div></div>
                ) : null}
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
            ) : null}
          </div>

          <form className="composer-card" onSubmit={(event) => void submit(event)}>
            <textarea
              ref={textareaRef}
              rows={1}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder="Message Roder…"
            />
            <div className="composer-actions">
              {controlMode ? <span className={`mode-pill ${controlMode}`}>{controlMode}</span> : null}
              <button className="composer-send" type="submit" disabled={!text.trim()} aria-label="Send message">
                <ArrowUp size={16} />
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

export default SidePanelApp;
