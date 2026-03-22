import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function RegisterPage() {
  const { register, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ username: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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

    if (!form.username.trim() || !form.password || !form.confirm) {
      setError('Please fill in all fields.');
      return;
    }
    if (form.username.trim().length < 3) {
      setError('Username must be at least 3 characters.');
      return;
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (form.password !== form.confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await register(form.username.trim(), form.password);
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
        <header className="auth-logo">
          <div className="logo-icon" aria-hidden="true">⚡</div>
          <h1>CollabCode</h1>
          <p>Real-time collaborative code editor</p>
        </header>

        <div className="auth-card">
          <h2>Create your account</h2>

          {error && (
            <div className="alert alert-error" role="alert" aria-live="assertive" style={{ marginBottom: '1.25rem' }}>
              ⚠️ {error}
            </div>
          )}

          <form className="auth-form" id="register-form" onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label className="form-label" htmlFor="reg-username">Username</label>
              <input
                id="reg-username"
                name="username"
                type="text"
                className="form-input"
                placeholder="Choose a username (3–30 chars)"
                value={form.username}
                onChange={handleChange}
                autoComplete="username"
                required
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="reg-password">Password</label>
              <input
                id="reg-password"
                name="password"
                type="password"
                className="form-input"
                placeholder="At least 6 characters"
                value={form.password}
                onChange={handleChange}
                autoComplete="new-password"
                required
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="reg-confirm">Confirm password</label>
              <input
                id="reg-confirm"
                name="confirm"
                type="password"
                className="form-input"
                placeholder="Repeat your password"
                value={form.confirm}
                onChange={handleChange}
                autoComplete="new-password"
                required
                disabled={loading}
              />
            </div>

            <button
              id="register-submit-btn"
              type="submit"
              className={`btn btn-primary btn-full btn-lg${loading ? ' btn-loading' : ''}`}
              disabled={loading}
            >
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p className="auth-footer">
            Already have an account?{' '}
            <Link to="/login" id="go-to-login">Sign in</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
