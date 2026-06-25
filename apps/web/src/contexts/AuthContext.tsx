'use client';
import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { api, ApiError } from '../lib/api';

interface AuthUser {
  id: string;
  email: string;
  role: 'dealer' | 'distributor' | 'admin';
  status: string;
  company_id: string | null;
}

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    try {
      const data = await api.get<AuthUser>('/auth/me');
      setUser(data);
    } catch {
      localStorage.removeItem('tt_token');
      setUser(null);
    }
  }, []);

  useEffect(() => {
    if (localStorage.getItem('tt_token')) {
      fetchMe().finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [fetchMe]);

  const login = async (email: string, password: string) => {
    const { access_token } = await api.post<{ access_token: string }>('/auth/login', { email, password });
    localStorage.setItem('tt_token', access_token);
    await fetchMe();
  };

  const logout = () => {
    localStorage.removeItem('tt_token');
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
