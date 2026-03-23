import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <nav className="navbar" role="navigation" aria-label="Main navigation">
      <Link to="/dashboard" className="navbar-brand">
        <img src="/Gemini_Generated_Image_g65hoig65hoig65h.png" alt="CollabCode Logo" className="brand-icon" />
        CollabCode
      </Link>

      <div className="navbar-actions">
        {user && (
          <>
            <div className="user-chip" aria-label={`Logged in as ${user.username}`}>
              <div className="avatar" aria-hidden="true">
                {user.username.charAt(0).toUpperCase()}
              </div>
              {user.username}
            </div>
            <button
              id="logout-btn"
              className="btn btn-ghost btn-sm"
              onClick={handleLogout}
              aria-label="Log out"
            >
              Sign out
            </button>
          </>
        )}
      </div>
    </nav>
  );
}
