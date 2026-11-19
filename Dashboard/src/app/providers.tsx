'use client';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { fbAuth } from '@/lib/firebase';
import { I18nProvider } from '@/lib/i18n';

interface AuthCtx { user: User | null; ready: boolean; }
const AuthContext = createContext<AuthCtx>({ user: null, ready: false });
export function useAuth(): AuthCtx { return useContext(AuthContext); }

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const unsub = onAuthStateChanged(fbAuth(), (u) => { setUser(u); setReady(true); });
    return () => unsub();
  }, []);
  return <AuthContext.Provider value={{ user, ready }}>{children}</AuthContext.Provider>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <AuthProvider>{children}</AuthProvider>
    </I18nProvider>
  );
}
