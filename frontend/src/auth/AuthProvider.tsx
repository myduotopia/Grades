import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

import { supabase } from '../lib/supabase'

interface AuthContextValue {
  session: Session | null
  loading: boolean
}

const AuthContext = createContext<AuthContextValue>({ session: null, loading: true })

/**
 * Synchronously peek at localStorage for an existing Supabase session and
 * decide whether it's already dead. Supabase v2 stores the session at a key
 * like `sb-<project-ref>-auth-token`; the value is a JSON blob containing
 * `expires_at` (UNIX seconds). If that's in the past we can short-circuit
 * the whole `getSession()` flow — calling getSession() in that state would
 * trigger an auto-refresh, and if the refresh request hangs the app sits on
 * the loading screen indefinitely.
 *
 * Returning `{ kind: 'dead' }` means: don't even ask Supabase, just sign out
 * locally and route to /login.
 * Returning `{ kind: 'unknown' }` means: behave normally — let getSession()
 * + onAuthStateChange handle it.
 */
function peekStoredSession(): { kind: 'dead' } | { kind: 'unknown' } {
  try {
    const nowSec = Math.floor(Date.now() / 1000)
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith('sb-') || !key.endsWith('-auth-token')) continue
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      const sess = parsed?.currentSession ?? parsed
      const expiresAt: number | undefined = sess?.expires_at
      if (typeof expiresAt !== 'number') continue
      if (expiresAt < nowSec) return { kind: 'dead' }
    }
  } catch {
    // Storage unreadable / JSON malformed — fall through to "unknown".
  }
  return { kind: 'unknown' }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Fast-path: storage says we're already dead → don't ask Supabase at all.
    if (peekStoredSession().kind === 'dead') {
      void supabase.auth.signOut({ scope: 'local' }).catch(() => {})
      setSession(null)
      setLoading(false)
    } else {
      // Normal path: just read storage. getSession() does NOT hit the network;
      // any refresh runs in the background via the SDK's worker and surfaces
      // through onAuthStateChange (`TOKEN_REFRESHED` / `SIGNED_OUT`).
      supabase.auth.getSession().then(({ data }) => {
        setSession(data.session)
        setLoading(false)
      })
    }

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      // TOKEN_REFRESHED → fresh session; SIGNED_OUT (emitted on refresh
      // failure or manual logout) → null. ProtectedRoute handles the redirect.
      setSession(newSession)
      setLoading(false)
    })

    return () => {
      subscription.subscription.unsubscribe()
    }
  }, [])

  return (
    <AuthContext.Provider value={{ session, loading }}>{children}</AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}
