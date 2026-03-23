import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Redirect if already logged in
  if (isAuthenticated) {
    navigate('/dashboard', { replace: true });
    return null;
  }

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    if (error) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.username.trim() || !form.password) {
      setError('Please fill in all fields.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await login(form.username.trim(), form.password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-container">
        {/* Logo */}
        <header className="auth-logo">
          <img src="/Gemini_Generated_Image_g65hoig65hoig65h.png" alt="CollabCode Logo" className="logo-icon" />
          <h1>CollabCode</h1>
          <p>Real-time collaborative code editor</p>
        </header>

        {/* Card */}
        <div className="auth-card">
          <h2>Welcome back</h2>

          {error && (
            <div className="alert alert-error" role="alert" aria-live="assertive" style={{ marginBottom: '1.25rem' }}>
              ⚠️ {error}
            </div>
          )}

          <form className="auth-form" id="login-form" onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label className="form-label" htmlFor="login-username">Username</label>
              <input
                id="login-username"
                name="username"
                type="text"
                className="form-input"
                placeholder="Enter your username"
                value={form.username}
                onChange={handleChange}
                autoComplete="username"
                required
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="login-password">Password</label>
              <input
                id="login-password"
                name="password"
                type="password"
                className="form-input"
                placeholder="Enter your password"
                value={form.password}
                onChange={handleChange}
                autoComplete="current-password"
                required
                disabled={loading}
              />
            </div>

            <button
              id="login-submit-btn"
              type="submit"
              className={`btn btn-primary btn-full btn-lg${loading ? ' btn-loading' : ''}`}
              disabled={loading}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="auth-footer">
            Don&apos;t have an account?{' '}
            <Link to="/register" id="go-to-register">Create one</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
