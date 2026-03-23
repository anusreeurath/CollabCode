import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Navbar from '../components/Navbar.jsx';
import api from '../services/api.js';

const LANGUAGES = [
  'javascript', 'typescript', 'python', 'java', 'cpp',
  'c', 'csharp', 'go', 'rust', 'html', 'css', 'json',
  'markdown', 'sql', 'php', 'ruby', 'swift', 'kotlin',
];

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Trash / Delete icon SVG ──────────────────────────────────────────────────
function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

// ── Delete Confirmation Modal ─────────────────────────────────────────────────
function DeleteConfirmModal({ room, onConfirm, onClose, loading }) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-room-title">
      <div className="modal" style={{ maxWidth: '400px' }}>
        <div className="modal-header">
          <h2 id="delete-room-title" style={{ color: 'var(--clr-error)' }}>🗑️ Remove Room</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close modal" disabled={loading}>✕</button>
        </div>

        <p style={{ color: 'var(--clr-text-200)', marginBottom: '0.5rem', fontSize: '0.95rem' }}>
          Remove <strong style={{ color: 'var(--clr-text-100)' }}>"{room.name}"</strong> from your dashboard?
          This only affects your view — other members can still access the room.
        </p>

        <div className="modal-actions" style={{ marginTop: '1.5rem' }}>
          <button
            id="confirm-delete-room-btn"
            className={`btn btn-danger${loading ? ' btn-loading' : ''}`}
            style={{ flex: 1 }}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'Removing…' : 'Remove from Dashboard'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Room Card ──────────────────────────────────────────────────────────────────
function RoomCard({ room, userId, onDeleted }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Coerce both to strings to handle ObjectId vs plain-string comparison safely
  const isOwner = room.createdBy && String(room.createdBy) === String(userId);

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError('');
    try {
      // DELETE now means "hide from my dashboard" for everyone — no permanent deletion
      await api.delete(`/rooms/${room.roomId}`);
      setShowConfirm(false);
      onDeleted(room.roomId);
    } catch (err) {
      // axios interceptor wraps errors as plain Error — err.message already has the text
      setDeleteError(err.message || 'Failed to remove room');
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="room-card-wrapper">
        <Link
          to={`/room/${room.roomId}`}
          className="room-card"
          id={`room-card-${room.roomId}`}
          aria-label={`Open room: ${room.name}`}
        >
          <div className="room-card-name">
            {room.name}
            {!isOwner && (
              <span className="room-badge-joined" title="You joined this room">Joined</span>
            )}
          </div>
          <div className="room-card-meta">
            <span className="lang-badge">{room.language}</span>
            <span>{formatDate(room.createdAt)}</span>
          </div>
          <div className="room-card-id">ID: {room.roomId}</div>
        </Link>

        {/* Delete / Leave button */}
        <button
          className="room-delete-btn"
          id={`delete-room-btn-${room.roomId}`}
          aria-label={`Remove room ${room.name} from dashboard`}
          title="Remove from dashboard"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowConfirm(true); }}
        >
          <TrashIcon />
        </button>

        {deleteError && (
          <div className="alert alert-error" role="alert" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
            ⚠️ {deleteError}
          </div>
        )}
      </div>

      {showConfirm && (
        <DeleteConfirmModal
          room={room}
          onConfirm={handleDelete}
          onClose={() => { setShowConfirm(false); setDeleteError(''); }}
          loading={deleting}
        />
      )}
    </>
  );
}

// ── Create Room Modal ────────────────────────────────────────────────────────
function CreateRoomModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', language: 'javascript' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Room name is required'); return; }

    setLoading(true);
    setError('');
    try {
      const { data } = await api.post('/rooms', form);
      onCreated(data.room);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="create-room-title">
      <div className="modal">
        <div className="modal-header">
          <h2 id="create-room-title">Create a new room</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close modal">✕</button>
        </div>

        {error && (
          <div className="alert alert-error" role="alert" style={{ marginBottom: '1rem' }}>
            ⚠️ {error}
          </div>
        )}

        <form className="modal-form" id="create-room-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="room-name-input">Room name</label>
            <input
              id="room-name-input"
              type="text"
              className="form-input"
              placeholder="e.g. Interview Prep, Leetcode Session"
              value={form.name}
              onChange={(e) => { setForm(p => ({ ...p, name: e.target.value })); setError(''); }}
              autoFocus
              required
              disabled={loading}
              maxLength={60}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="room-language-select">Language</label>
            <select
              id="room-language-select"
              className="form-input"
              value={form.language}
              onChange={(e) => setForm(p => ({ ...p, language: e.target.value }))}
              disabled={loading}
            >
              {LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {lang.charAt(0).toUpperCase() + lang.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div className="modal-actions">
            <button
              id="create-room-submit-btn"
              type="submit"
              className={`btn btn-primary${loading ? ' btn-loading' : ''}`}
              style={{ flex: 1 }}
              disabled={loading}
            >
              {loading ? 'Creating…' : '⚡ Create Room'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Dashboard Page ────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [rooms, setRooms] = useState([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [fetchError, setFetchError] = useState('');

  const fetchRooms = useCallback(async () => {
    setLoadingRooms(true);
    setFetchError('');
    try {
      const { data } = await api.get('/rooms');
      setRooms(data.rooms || []);
    } catch (err) {
      setFetchError(err.message);
    } finally {
      setLoadingRooms(false);
    }
  }, []);

  useEffect(() => { fetchRooms(); }, [fetchRooms]);

  const handleRoomCreated = (room) => {
    setShowModal(false);
    navigate(`/room/${room.roomId}`);
  };

  return (
    <>
      <Navbar />

      <main className="dashboard-page">
        {/* Header */}
        <div className="dashboard-header">
          <div>
            <h1>My Rooms</h1>
            <p>Welcome back, <strong>{user?.username}</strong>. Pick up where you left off.</p>
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Join existing room form */}
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                const id = e.target.elements.joinId.value.trim();
                if (id) navigate(`/room/${id}`);
              }}
              style={{ display: 'flex', gap: '0.5rem' }}
            >
              <input 
                name="joinId" 
                type="text" 
                placeholder="Paste Room ID..." 
                className="form-input" 
                style={{ padding: '0.5rem 0.8rem', width: '220px' }} 
              />
              <button type="submit" className="btn btn-secondary">Join</button>
            </form>

            <button
              id="open-create-room-btn"
              className="btn btn-primary"
              onClick={() => setShowModal(true)}
            >
              + New Room
            </button>
          </div>
        </div>

        {/* Room list */}
        <section className="rooms-section" aria-label="Your rooms">
          <h2>Recent rooms</h2>

          {fetchError && (
            <div className="alert alert-error" role="alert" style={{ marginBottom: '1.5rem' }}>
              ⚠️ {fetchError}
              <button className="btn btn-ghost btn-sm" onClick={fetchRooms} style={{ marginLeft: '1rem' }}>
                Retry
              </button>
            </div>
          )}

          {loadingRooms ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem 0' }}>
              <div className="spinner" role="status" aria-label="Loading rooms" />
            </div>
          ) : (
            <div className="rooms-grid">
              {rooms.length === 0 ? (
                <div className="empty-rooms">
                  <div className="empty-icon">🗂️</div>
                  <p>No rooms yet. Create your first collaborative session!</p>
                  <button
                    id="create-first-room-btn"
                    className="btn btn-primary"
                    onClick={() => setShowModal(true)}
                  >
                    + Create Room
                  </button>
                </div>
              ) : (
                rooms.map((room) => (
                  <RoomCard
                    key={room.roomId}
                    room={room}
                    userId={user?.id}
                    onDeleted={(roomId) => setRooms(prev => prev.filter(r => r.roomId !== roomId))}
                  />
                ))
              )}
            </div>
          )}
        </section>
      </main>

      {showModal && (
        <CreateRoomModal
          onClose={() => setShowModal(false)}
          onCreated={handleRoomCreated}
        />
      )}
    </>
  );
}
