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
                  <Link
                    key={room.roomId}
                    to={`/room/${room.roomId}`}
                    className="room-card"
                    id={`room-card-${room.roomId}`}
                    aria-label={`Open room: ${room.name}`}
                  >
                    <div className="room-card-name">
                      {room.name}
                      {room.createdBy && room.createdBy !== user?._id && room.createdBy?._id !== user?._id && (
                        <span className="room-badge-joined" title="You joined this room">Joined</span>
                      )}
                    </div>
                    <div className="room-card-meta">
                      <span className="lang-badge">{room.language}</span>
                      <span>{formatDate(room.createdAt)}</span>
                    </div>
                    <div className="room-card-id">ID: {room.roomId}</div>
                  </Link>
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
