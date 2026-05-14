import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

import { supabase } from '../lib/supabase'

interface AuthContextValue {
  session: Session | null
  loading: boolean
}

const AuthContext = createContext<AuthContextValue>({ session: null, loading: true })

// Initial-load timeout: if Supabase's getSession() doesn't resolve within
// this window (typically because the auto-refresh worker is stuck on a
// dead refresh_token request), we treat it as no session and unblock the
// spinner. ProtectedRoute then redirects to /login.
const INITIAL_AUTH_TIMEOUT_MS = 6000

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let settled = false

    function resolve(s: Session | null) {
      if (settled) return
      settled = true
      setSession(s)
      setLoading(false)
    }

    // Race getSession() against a hard timeout. The timeout path also clears
    // local storage so the broken refresh worker can't keep retrying.
    const timer = window.setTimeout(() => {
      if (settled) return
      void supabase.auth.signOut({ scope: 'local' }).catch(() => {})
      resolve(null)
    }, INITIAL_AUTH_TIMEOUT_MS)

    supabase.auth.getSession().then(({ data }) => {
      window.clearTimeout(timer)
      const s = data.session
      // Belt-and-braces: if the stored access token is already expired and
      // the refresh hasn't kicked in yet, drop the session. The AuthProvider
      // listener below will re-set a fresh one if refresh later succeeds.
      const nowSec = Math.floor(Date.now() / 1000)
      if (s && s.expires_at && s.expires_at < nowSec) {
        void supabase.auth.signOut({ scope: 'local' }).catch(() => {})
        resolve(null)
        return
      }
      resolve(s)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      // Once mounted we trust Supabase's events: TOKEN_REFRESHED gives us a
      // fresh session; SIGNED_OUT (also emitted on refresh failure) gives null
      // and ProtectedRoute will redirect.
      setSession(newSession)
      if (!settled) {
        settled = true
        setLoading(false)
        window.clearTimeout(timer)
      }
    })

    return () => {
      window.clearTimeout(timer)
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
