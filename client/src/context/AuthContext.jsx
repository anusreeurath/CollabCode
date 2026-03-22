import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => sessionStorage.getItem('cc_token'));
  const [loading, setLoading] = useState(true);

  // Verify token on mount / tab focus
  useEffect(() => {
    const verifyToken = async () => {
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const { data } = await api.get('/auth/me');
        setUser(data.user);
      } catch {
        // Token invalid or expired — clear it
        logout();
      } finally {
        setLoading(false);
      }
    };

    verifyToken();
  }, [token]);

  const login = useCallback(async (username, password) => {
    const { data } = await api.post('/auth/login', { username, password });
    sessionStorage.setItem('cc_token', data.token);
    setToken(data.token);
    setUser(data.user);
    return data;
  }, []);

  const register = useCallback(async (username, password) => {
    const { data } = await api.post('/auth/register', { username, password });
    sessionStorage.setItem('cc_token', data.token);
    setToken(data.token);
    setUser(data.user);
    return data;
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem('cc_token');
    setToken(null);
    setUser(null);
  }, []);

  const value = {
    user,
    token,
    loading,
    isAuthenticated: !!user,
    login,
    register,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
