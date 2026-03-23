import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import * as Y from 'yjs';
import { SocketIOProvider } from 'y-socket.io';
import { createMonacoBinding } from '../lib/monacoYjsBinding.js';
import { useAuth } from '../context/AuthContext.jsx';
import { connectSocket, disconnectSocket } from '../services/socket.js';
import api from '../services/api.js';

// ── Cursor colors ─────────────────────────────────────────────────────────
const CURSOR_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
];

// ── Language maps ─────────────────────────────────────────────────────────
const LANGUAGES = [
  { key: 'javascript', id: 93,  name: 'JavaScript (Node.js)',  monaco: 'javascript' },
  { key: 'python',     id: 71,  name: 'Python 3',               monaco: 'python'     },
  { key: 'cpp',        id: 54,  name: 'C++ (GCC 17)',           monaco: 'cpp'        },
  { key: 'c',          id: 50,  name: 'C (GCC)',                monaco: 'c'          },
  { key: 'java',       id: 62,  name: 'Java',                   monaco: 'java'       },
  { key: 'go',         id: 60,  name: 'Go',                     monaco: 'go'         },
  { key: 'rust',       id: 73,  name: 'Rust',                   monaco: 'rust'       },
];

const LANG_BY_KEY = Object.fromEntries(LANGUAGES.map((l) => [l.key, l]));

// ── Helpers ───────────────────────────────────────────────────────────────
function pickColor(username) {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

function formatTs(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// ── Tiny markdown renderer (bold + inline code only) ─────────────────────
function renderMd(text) {
  const parts = [];
  let key = 0;
  // Split on code blocks first, then bold
  const segments = text.split(/(```[\s\S]*?```|`[^`]+`|\*\*[^*]+\*\*)/g);
  for (const seg of segments) {
    if (!seg) continue;
    if (seg.startsWith('```') && seg.endsWith('```')) {
      const code = seg.slice(3, -3).replace(/^\w*\n/, '');
      parts.push(<pre key={key++} className="ai-code-block"><code>{code}</code></pre>);
    } else if (seg.startsWith('`') && seg.endsWith('`')) {
      parts.push(<code key={key++} className="ai-inline-code">{seg.slice(1, -1)}</code>);
    } else if (seg.startsWith('**') && seg.endsWith('**')) {
      parts.push(<strong key={key++}>{seg.slice(2, -2)}</strong>);
    } else {
      // Preserve newlines
      const lines = seg.split('\n');
      lines.forEach((line, i) => {
        parts.push(<span key={key++}>{line}</span>);
        if (i < lines.length - 1) parts.push(<br key={key++} />);
      });
    }
  }
  return parts;
}

// ── Presence pill ─────────────────────────────────────────────────────────
function PresencePill({ name, color, isNew }) {
  return (
    <div
      className={`presence-pill${isNew ? ' presence-pill--enter' : ''}`}
      title={name}
      style={{ '--pill-color': color }}
    >
      <span className="presence-pill-dot" style={{ background: color }} />
      <span className="presence-pill-initial">{name.charAt(0).toUpperCase()}</span>
    </div>
  );
}

// ── Spinner ───────────────────────────────────────────────────────────────
function InlineSpinner() {
  return <span className="inline-spinner" aria-hidden="true" />;
}

// ═══════════════════════════════════════════════════════════════════════════
export default function RoomPage() {
  const { roomId } = useParams();
  const { user, token } = useAuth();

  // ── Room / connection state ──────────────────────────────────────────
  const [room, setRoom]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [connected, setConnected] = useState(false);
  const [copied, setCopied]     = useState(false);
  const [awarenessUsers, setAwarenessUsers] = useState([]);

  // ── Language + execution state ───────────────────────────────────────
  const [langKey, setLangKey]   = useState('javascript');
  const [executing, setExecuting] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [outputTab, setOutputTab] = useState('output');
  const [stdin, setStdin]       = useState('');
  const [showStdin, setShowStdin] = useState(false);

  // ── Resizable panel state ────────────────────────────────────────────
  const [panelHeight, setPanelHeight] = useState(220);
  const isDragging  = useRef(false);
  const dragStartY  = useRef(0);
  const dragStartH  = useRef(0);

  // ── AI Explainer state ───────────────────────────────────────────────
  const [explaining, setExplaining]   = useState(false);
  const [explanation, setExplanation] = useState('');  // accumulated SSE text
  const [explainDone, setExplainDone] = useState(false);
  const [explainError, setExplainError] = useState('');
  const abortRef = useRef(null); // AbortController for SSE fetch

  // ── History drawer state ─────────────────────────────────────────────
  const [showHistory, setShowHistory]   = useState(false);
  const [snapshots, setSnapshots]       = useState([]);
  const [histLoading, setHistLoading]   = useState(false);
  const [histError, setHistError]       = useState('');
  const [restoringId, setRestoringId]   = useState(null);

  // ── Auto-save refs ───────────────────────────────────────────────────
  const lastSavedCodeRef = useRef('');
  const autoSaveTimer    = useRef(null);

  // ── Refs ──────────────────────────────────────────────────────────────
  const socketRef    = useRef(null);
  const editorRef    = useRef(null);
  const monacoRef    = useRef(null);
  const ydocRef      = useRef(null);
  const providerRef  = useRef(null);
  const bindingRef   = useRef(null);
  const newUserIdsRef = useRef(new Set());

  // ── Fetch room metadata ───────────────────────────────────────────────
  useEffect(() => {
    const fetch_ = async () => {
      try {
        const { data } = await api.get(`/rooms/${roomId}`);
        setRoom(data.room);
        if (data.room.language && LANG_BY_KEY[data.room.language]) {
          setLangKey(data.room.language);
        }
        api.post(`/rooms/${roomId}/join`).catch(() => {});
      } catch (err) {
        setError(err.response?.data?.error || err.message);
      } finally {
        setLoading(false);
      }
    };
    fetch_();
  }, [roomId]);

  // ── Socket.io for presence ────────────────────────────────────────────
  useEffect(() => {
    if (!roomId || !user) return;
    const socket = connectSocket();
    socketRef.current = socket;
    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join-room', { roomId, username: user.username });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
      disconnectSocket();
      setConnected(false);
    };
  }, [roomId, user]);

  // ── Yjs setup ─────────────────────────────────────────────────────────
  const initYjs = useCallback(
    (editor) => {
      if (!user || !roomId) return;
      const ydoc = new Y.Doc();
      ydocRef.current = ydoc;
      const serverUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';
      const provider = new SocketIOProvider(serverUrl, `yjs|${roomId}`, ydoc, {
        autoConnect: true,
        gcEnabled: true,
      });
      providerRef.current = provider;
      const myColor = pickColor(user.username);
      provider.awareness.setLocalStateField('user', { name: user.username, color: myColor });
      const updatePresence = () => {
        const states = Array.from(provider.awareness.getStates().entries());
        const localId = provider.awareness.clientID;
        const uniqueUsers = new Map();
        states.forEach(([id, state]) => {
          if (id === localId || !state?.user) return;
          if (!uniqueUsers.has(state.user.name)) {
            uniqueUsers.set(state.user.name, {
              clientId: id, name: state.user.name, color: state.user.color,
            });
          }
        });
        const users = Array.from(uniqueUsers.values());
        setAwarenessUsers((prev) => {
          const prevNames = new Set(prev.map((u) => u.name));
          users.forEach((u) => { if (!prevNames.has(u.name)) newUserIdsRef.current.add(u.name); });
          setTimeout(() => { newUserIdsRef.current.clear(); }, 600);
          return users;
        });
      };
      provider.awareness.on('change', updatePresence);
      const ytext = ydoc.getText('monaco');
      const binding = createMonacoBinding(ytext, editor, provider.awareness);
      bindingRef.current = binding;
      provider.on('sync', (ok) => console.log('[Yjs] Synced:', ok));
    },
    [user, roomId],
  );

  useEffect(() => {
    return () => {
      bindingRef.current?.destroy();
      providerRef.current?.disconnect();
      ydocRef.current?.destroy();
    };
  }, []);

  // ── Editor mount ──────────────────────────────────────────────────────
  const handleEditorDidMount = useCallback(
    (editor, monaco) => {
      editorRef.current  = editor;
      monacoRef.current  = monaco;
      editor.focus();
      initYjs(editor);
    },
    [initYjs],
  );

  // ── Language change ───────────────────────────────────────────────────
  const handleLangChange = useCallback((e) => {
    const newKey = e.target.value;
    setLangKey(newKey);
    if (editorRef.current && monacoRef.current) {
      const model = editorRef.current.getModel();
      if (model) monacoRef.current.editor.setModelLanguage(model, LANG_BY_KEY[newKey].monaco);
    }
  }, []);

  // ── Copy room ID ──────────────────────────────────────────────────────
  const handleCopyRoomId = useCallback(() => {
    navigator.clipboard.writeText(roomId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [roomId]);

  // ── Execute ───────────────────────────────────────────────────────────
  const handleExecute = useCallback(async () => {
    if (executing) return;
    if (!editorRef.current) return;
    const lang = LANG_BY_KEY[langKey];
    const code = editorRef.current.getValue();
    if (!code.trim()) return;
    setExecuting(true);
    setRunResult(null);
    setOutputTab('output');
    // Reset explainer when re-running
    setExplanation('');
    setExplainDone(false);
    setExplainError('');
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
      const res = await fetch(`${apiUrl}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          source_code: code,
          language_id: lang.id,
          ...(stdin.trim() ? { stdin } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRunResult({ error: data.error || `HTTP ${res.status}` });
        setOutputTab('errors');
        return;
      }
      setRunResult(data);
      const hasErrors = data.stderr || data.compile_output || (data.status?.id && data.status.id > 3);
      if (hasErrors) setOutputTab('errors');
    } catch (err) {
      setRunResult({ error: `Network error: ${err.message}` });
      setOutputTab('errors');
    } finally {
      setExecuting(false);
    }
  }, [executing, langKey, stdin, token]);

  // ── Keyboard shortcut: Ctrl+Enter ────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleExecute(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleExecute]);

  // ── Resizable panel drag ──────────────────────────────────────────────
  const onDragStart = useCallback((e) => {
    isDragging.current  = true;
    dragStartY.current  = e.clientY;
    dragStartH.current  = panelHeight;
    document.body.style.userSelect = 'none';
    document.body.style.cursor     = 'row-resize';
  }, [panelHeight]);

  useEffect(() => {
    const onMove = (e) => {
      if (!isDragging.current) return;
      const delta = dragStartY.current - e.clientY;
      const next  = Math.max(120, Math.min(600, dragStartH.current + delta));
      setPanelHeight(next);
    };
    const onUp = () => {
      isDragging.current = false;
      document.body.style.userSelect = '';
      document.body.style.cursor     = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // ── AI Error Explainer ────────────────────────────────────────────────
  const handleExplain = useCallback(async () => {
    if (!editorRef.current || explaining) return;
    const code = editorRef.current.getValue();
    const errorText = runResult
      ? (runResult.error || [runResult.compile_output, runResult.stderr].filter(Boolean).join('\n'))
      : '';
    if (!errorText) return;

    // Abort any previous stream
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setExplaining(true);
    setExplanation('');
    setExplainDone(false);
    setExplainError('');

    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
      const res = await fetch(`${apiUrl}/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ error: errorText, code, language: LANG_BY_KEY[langKey].name, roomId }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json();
        setExplainError(data.error || 'Explain request failed');
        setExplaining(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') { setExplainDone(true); continue; }
          try {
            const parsed = JSON.parse(payload);
            if (parsed.error) { setExplainError(parsed.error); }
            else if (parsed.text) { setExplanation((prev) => prev + parsed.text); }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') setExplainError(err.message);
    } finally {
      setExplaining(false);
    }
  }, [explaining, runResult, langKey, token, roomId]);

  // ── Auto-save snapshot every 60s ─────────────────────────────────────
  const saveSnapshot = useCallback(async () => {
    if (!editorRef.current || !user || !roomId) return;
    const code = editorRef.current.getValue();
    if (!code.trim() || code === lastSavedCodeRef.current) return;
    lastSavedCodeRef.current = code;
    try {
      await api.post(`/rooms/${roomId}/snapshot`, { code, language: langKey });
    } catch { /* silent — auto-save should never interrupt the user */ }
  }, [user, roomId, langKey]);

  useEffect(() => {
    autoSaveTimer.current = setInterval(saveSnapshot, 60_000);
    return () => clearInterval(autoSaveTimer.current);
  }, [saveSnapshot]);

  // ── History drawer ────────────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    setHistError('');
    try {
      const { data } = await api.get(`/rooms/${roomId}/snapshots`);
      setSnapshots(data.snapshots || []);
    } catch (err) {
      setHistError(err.message);
    } finally {
      setHistLoading(false);
    }
  }, [roomId]);

  const handleOpenHistory = useCallback(() => {
    setShowHistory(true);
    loadHistory();
  }, [loadHistory]);

  const handleRestore = useCallback(async (snap) => {
    if (!editorRef.current || !ydocRef.current) return;
    setRestoringId(snap._id);
    try {
      // Apply through Yjs so all collaborators see it instantly
      const ytext = ydocRef.current.getText('monaco');
      ydocRef.current.transact(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, snap.code);
      });
      setLangKey(snap.language);
      if (editorRef.current && monacoRef.current) {
        const model = editorRef.current.getModel();
        if (model) monacoRef.current.editor.setModelLanguage(model, LANG_BY_KEY[snap.language]?.monaco || snap.language);
      }
      setShowHistory(false);
    } finally {
      setRestoringId(null);
    }
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────
  const myColor     = user ? pickColor(user.username) : '#aaa';
  const onlineCount = awarenessUsers.length + 1;
  const statusId    = runResult?.status?.id;
  const isSuccess   = statusId === 3;
  const isError     = statusId && statusId > 3;
  // hasRunError: true if any form of error is detected, including runtime errors in stdout
  const hasRunError = runResult && (
    runResult.error ||
    runResult.stderr ||
    runResult.compile_output ||
    isError ||
    // Safety net: JDoodle sometimes puts runtime errors in stdout (e.g. Python NameError)
    (runResult.stdout && /\w+Error:|Traceback|Exception in thread|panic:/m.test(runResult.stdout))
  );

  // ── Loading / error states ────────────────────────────────────────────
  if (loading) {
    return (
      <div className="loading-page" role="status">
        <div className="spinner" aria-hidden="true" />
        <span>Loading room…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="loading-page">
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🚫</div>
          <h2 style={{ marginBottom: '0.5rem' }}>Room not found</h2>
          <p style={{ color: 'var(--clr-text-400)', marginBottom: '1.5rem' }}>{error}</p>
          <Link to="/dashboard" className="btn btn-primary">← Back to Dashboard</Link>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  return (
    <div className="room-page">

      {/* ── Toolbar ──────────────────────────────────────────────────── */}
      <header className="editor-navbar" role="banner">
        <div className="editor-navbar-left">
          <Link to="/dashboard" className="btn btn-ghost btn-sm" aria-label="Back to dashboard">←</Link>

          <span className="editor-room-name" title={room?.name}>{room?.name || roomId}</span>

          <button
            id="copy-room-id-btn"
            className="room-id-badge"
            onClick={handleCopyRoomId}
            title="Click to copy Room ID"
          >
            🔗 {roomId.slice(0, 8)}… {copied ? '✓' : ''}
          </button>

          <div className="toolbar-divider" />

          {/* Language selector */}
          <select
            id="language-selector"
            value={langKey}
            onChange={handleLangChange}
            className="language-select"
            disabled={executing}
            title="Select programming language"
          >
            {LANGUAGES.map((l) => (
              <option key={l.key} value={l.key}>{l.name}</option>
            ))}
          </select>

          {/* Run button */}
          <button
            id="run-code-btn"
            onClick={handleExecute}
            disabled={executing}
            className={`btn btn-sm run-btn ${executing ? 'btn-secondary run-btn--running' : 'btn-primary'}`}
            title="Run code (Ctrl+Enter)"
          >
            {executing ? <><InlineSpinner /> Running…</> : <>▶ Run Code</>}
          </button>

          <div className="toolbar-divider" />

          {/* History button */}
          <button
            id="history-btn"
            className="btn btn-ghost btn-sm"
            onClick={handleOpenHistory}
            title="View code history"
          >
            🕒 History
          </button>
        </div>

        <div className="editor-navbar-right">
          {/* Presence */}
          <div className="presence-bar" aria-label="Online users" role="status">
            {user && <PresencePill key="self" name={user.username} color={myColor} isNew={false} />}
            {awarenessUsers.map((u) => (
              <PresencePill
                key={`remote-${u.name}`}
                name={u.name}
                color={u.color}
                isNew={newUserIdsRef.current.has(u.name)}
              />
            ))}
            <span className="presence-count">{onlineCount} online</span>
          </div>

          {/* Connection status */}
          <div className="connection-status" role="status">
            <span className={`status-dot${connected ? '' : ' disconnected'}`} aria-hidden="true" />
            {connected ? 'Live' : 'Connecting…'}
          </div>
        </div>
      </header>

      {/* ── Editor ───────────────────────────────────────────────────── */}
      <div className="editor-wrapper" role="main" aria-label="Code editor">
        <Editor
          height="100%"
          language={LANG_BY_KEY[langKey].monaco}
          theme="vs-dark"
          onMount={handleEditorDidMount}
          options={{
            fontSize: 15,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontLigatures: true,
            minimap: { enabled: true },
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            cursorSmoothCaretAnimation: 'on',
            lineNumbers: 'on',
            renderLineHighlight: 'gutter',
            bracketPairColorization: { enabled: true },
            formatOnPaste: true,
            tabSize: 2,
            automaticLayout: true,
            padding: { top: 16, bottom: 16 },
          }}
        />
      </div>

      {/* ── Output panel (resizable) ──────────────────────────────────── */}
      <div className="output-panel" style={{ height: panelHeight }}>

        {/* Drag handle */}
        <div
          className="output-resize-handle"
          onMouseDown={onDragStart}
          title="Drag to resize"
          aria-label="Resize output panel"
        />

        {/* Tabs Row */}
        <div className="output-tabs">
          {['output', 'errors', 'info'].map((tab) => (
            <button
              key={tab}
              className={`tab-btn ${outputTab === tab ? 'active' : ''} ${
                tab === 'errors' && isError ? 'tab-btn--error' : ''
              } ${tab === 'output' && isSuccess ? 'tab-btn--success' : ''}`}
              onClick={() => setOutputTab(tab)}
            >
              {tab === 'output' && 'Output'}
              {tab === 'errors' && (
                <>Errors{(runResult?.stderr || runResult?.compile_output || isError) && !executing ? ' ⚠' : ''}</>
              )}
              {tab === 'info' && 'Info'}
            </button>
          ))}

          <div style={{ flex: 1 }} />

          {/* Stdin toggle */}
          <button
            className={`tab-btn stdin-toggle-btn ${showStdin ? 'active' : ''}`}
            onClick={() => setShowStdin((v) => !v)}
            title="Toggle stdin input"
          >
            {showStdin ? '▾ stdin' : '▸ stdin'}
          </button>
        </div>

        {/* Stdin textarea (collapsible) */}
        {showStdin && (
          <div className="stdin-panel">
            <div className="stdin-header">
              <span>📥 Standard Input</span>
              <button onClick={() => setShowStdin(false)} className="btn-ghost btn-sm">✕</button>
            </div>
            <textarea
              className="stdin-textarea"
              value={stdin}
              onChange={(e) => setStdin(e.target.value)}
              placeholder="Enter program input (stdin)…"
              spellCheck={false}
            />
          </div>
        )}

        {/* Output Content */}
        <div className="output-content">

          {/* Executing overlay */}
          {executing && (
            <div className="output-running">
              <InlineSpinner />
              <span>Executing {LANG_BY_KEY[langKey].name} code…</span>
            </div>
          )}

          {/* Output tab */}
          {!executing && outputTab === 'output' && (
            <pre className={`output-text ${isSuccess ? 'success' : isError ? 'muted' : ''}`}>
              {runResult
                ? (runResult.error
                    ? `⚠ ${runResult.error}`
                    : runResult.stdout || '— No output —'
                  )
                : '▶ Press Run Code (or Ctrl+Enter) to execute.'}
            </pre>
          )}

          {/* Errors tab */}
          {!executing && outputTab === 'errors' && (
            <div className="errors-tab-content">
              <pre className="output-text error">
                {runResult
                  ? (runResult.error ||
                      [runResult.compile_output, runResult.stderr]
                        .filter(Boolean)
                        .join('\n') ||
                      (isError ? runResult.status?.description : '✓ No errors.')
                    )
                  : '✓ No errors.'}
              </pre>

              {/* AI Explain button — only when there's an error */}
              {hasRunError && !executing && (
                <div className="ai-explain-section">
                  {!explanation && !explaining && (
                    <button
                      id="explain-error-btn"
                      className="btn btn-sm ai-explain-btn"
                      onClick={handleExplain}
                      disabled={explaining}
                    >
                      <span className="ai-badge">AI</span>
                      Explain this error
                    </button>
                  )}

                  {explainError && (
                    <div className="ai-explain-error">⚠️ {explainError}</div>
                  )}

                  {(explaining || explanation) && (
                    <div className="ai-explain-panel">
                      <div className="ai-explain-header">
                        <span className="ai-badge">AI</span>
                        <span>Error Explanation</span>
                        {(explaining || !explainDone) && <span className="ai-cursor" />}
                        {explainDone && (
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ marginLeft: 'auto', fontSize: '0.75rem' }}
                            onClick={() => { setExplanation(''); setExplainDone(false); setExplainError(''); }}
                          >
                            ✕ Clear
                          </button>
                        )}
                      </div>
                      <div className="ai-explain-body">
                        {renderMd(explanation)}
                        {!explainDone && explanation === '' && (
                          <span style={{ color: 'var(--clr-text-muted)', fontSize: '0.85rem' }}>
                            Thinking…
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Info tab */}
          {!executing && outputTab === 'info' && (
            <div className="output-info">
              {runResult && !runResult.error ? (
                <>
                  <div className="info-row">
                    <span className="info-label">Status</span>
                    <span className={`info-value ${isSuccess ? 'info-success' : isError ? 'info-error' : ''}`}>
                      {runResult.status?.description || '—'}
                    </span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Language</span>
                    <span className="info-value">{LANG_BY_KEY[langKey].name}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Time</span>
                    <span className="info-value">{runResult.time ? `${runResult.time} s` : '—'}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Memory</span>
                    <span className="info-value">{runResult.memory ? `${runResult.memory} KB` : '—'}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Engine</span>
                    <span className={`info-value ${runResult.engine?.includes('local') ? 'info-success' : 'info-warning'}`}>
                      {runResult.engine?.includes('local')
                        ? `⚡ ${runResult.engine}`
                        : `☁ ${runResult.engine}`}
                    </span>
                  </div>
                </>
              ) : (
                <p className="output-text muted">Run your code to see execution info here.</p>
              )}
            </div>
          )}

        </div>
      </div>

      {/* ── History Drawer ────────────────────────────────────────────── */}
      {showHistory && (
        <div className="history-overlay" onClick={() => setShowHistory(false)}>
          <div className="history-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="history-header">
              <h2>🕒 Code History</h2>
              <button className="modal-close" onClick={() => setShowHistory(false)}>✕</button>
            </div>

            {histLoading && (
              <div className="history-loading">
                <div className="spinner" />
                <span>Loading snapshots…</span>
              </div>
            )}

            {histError && (
              <div className="alert alert-error" style={{ margin: '1rem' }}>⚠️ {histError}</div>
            )}

            {!histLoading && !histError && snapshots.length === 0 && (
              <div className="history-empty">
                <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem', opacity: 0.4 }}>📭</div>
                <p>No snapshots yet.</p>
                <p style={{ fontSize: '0.8rem', color: 'var(--clr-text-muted)', marginTop: '0.25rem' }}>
                  Auto-saves every 60 seconds when code changes.
                </p>
              </div>
            )}

            <div className="history-list">
              {snapshots.map((snap) => (
                <div key={snap._id} className="history-item">
                  <div className="history-item-meta">
                    <span className="lang-badge" style={{ fontSize: '0.7rem' }}>{snap.language}</span>
                    <span className="history-item-time">{formatTs(snap.savedAt)}</span>
                    <span className="history-item-author">by {snap.savedBy}</span>
                  </div>
                  <pre className="history-code-preview">
                    {snap.code.split('\n').slice(0, 3).join('\n') || '(empty)'}
                  </pre>
                  <button
                    className={`btn btn-sm btn-secondary history-restore-btn`}
                    onClick={() => handleRestore(snap)}
                    disabled={restoringId === snap._id}
                  >
                    {restoringId === snap._id ? <><InlineSpinner /> Restoring…</> : '↩ Restore'}
                  </button>
                </div>
              ))}
            </div>

            <div className="history-footer">
              <button className="btn btn-ghost btn-sm" onClick={loadHistory} disabled={histLoading}>
                🔄 Refresh
              </button>
              <button
                className="btn btn-sm btn-primary"
                onClick={async () => { await saveSnapshot(); loadHistory(); }}
              >
                💾 Save Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
