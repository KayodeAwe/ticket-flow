import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { request, setToken, setUnauthorizedHandler } from '../api/client';
import type { User } from '../api/types';

interface Session {
  readonly token: string;
  readonly user: User;
}

interface SessionContextValue {
  readonly user: User | null;
  signIn(email: string, password: string): Promise<User>;
  signOut(): void;
}

const STORAGE_KEY = 'ticket-flow.session';

/**
 * sessionStorage, not localStorage: a scanner handset shared between shifts should not stay
 * signed in as the last person once the tab is closed. Wrapped because storage can throw —
 * private windows, blocked site data — and signing in must still work for the tab's life.
 */
function readStoredSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'token' in parsed && 'user' in parsed) {
      return parsed as Session; // Written by writeStoredSession below, from a typed Session.
    }
  } catch {
    // Unreadable or unavailable storage: start signed out.
  }
  return null;
}

function writeStoredSession(session: Session | null): void {
  try {
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // The session still works in memory for this tab.
  }
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(() => {
    const stored = readStoredSession();
    setToken(stored?.token ?? null);
    return stored;
  });

  const signOut = useCallback(() => {
    setToken(null);
    writeStoredSession(null);
    setSession(null);
    // Another person may sign in next on this device. Nothing of the last one stays cached.
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    setUnauthorizedHandler(signOut);
  }, [signOut]);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await request<Session>('POST', '/auth/login', { email, password });
    setToken(result.token);
    writeStoredSession(result);
    setSession(result);
    return result.user;
  }, []);

  const value = useMemo(
    () => ({ user: session?.user ?? null, signIn, signOut }),
    [session, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>.');
  return value;
}

/** Where each role starts after signing in. */
export function homeFor(user: User): string {
  return user.role === 'SCANNER' ? '/gate' : '/events';
}
