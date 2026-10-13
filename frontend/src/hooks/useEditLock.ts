import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError, lockHolderFromError, type LockHolder } from '../lib/api'

/** Heartbeat period. The server forgets a lock 90 s after the last one, so
 *  a closed tab / lost connection frees the item within 90 s (#264 A4). */
export const LOCK_HEARTBEAT_MS = 25_000
/** No typing / clicking for this long → release the lock (A4). */
export const LOCK_IDLE_MS = 5 * 60_000
/** How often pages poll who-is-editing while visible (B5). */
export const LOCK_POLL_MS = 15_000

/** What the hook needs to talk to one side's lock endpoints. */
export interface LockOps {
  /** Acquire / renew. Rejects with ApiError (409 item_locked, 404, …). */
  acquire: (takeover: boolean) => Promise<unknown>
  /** Release; `keepalive` = the page is being left (B10). */
  release: (keepalive: boolean) => Promise<unknown> | void
}

/**
 * - `off`: not editing.
 * - `held`: we hold the lock; heart-beating.
 * - `paused`: idle 5 min → released; the next key / click re-acquires (A5).
 */
export type EditLockStatus = 'off' | 'held' | 'paused'

/**
 * Lost the lock while editing: `holder` is who has it now (taken over, or
 * re-acquire after idle found someone else), or null when the server said
 * 404 (permission gone, B7).
 */
export type LockLostHandler = (holder: LockHolder | null) => void

/**
 * Edit-lock lifecycle shared by the teacher grades page and the 小老師
 * page (#264). Pages call `start(ops, takeover)` when the pencil is
 * pressed (it rejects with the server's error so the caller can show
 * "○○ is editing" or ask to take over), `stop()` on save / cancel, and get
 * `onLost` when the lock goes away underneath them. While editing it
 * heart-beats, releases after 5 minutes idle, re-acquires on the next
 * activity, and releases (keepalive) when the page is left.
 */
export function useEditLock(onLost: LockLostHandler) {
  const [status, setStatus] = useState<EditLockStatus>('off')
  const statusRef = useRef<EditLockStatus>('off')
  const opsRef = useRef<LockOps | null>(null)
  const lastActivity = useRef(Date.now())
  const reacquiring = useRef(false)
  const onLostRef = useRef(onLost)
  onLostRef.current = onLost

  const set = useCallback((s: EditLockStatus) => {
    statusRef.current = s
    setStatus(s)
  }, [])

  const lose = useCallback(
    (err: unknown) => {
      const holder = lockHolderFromError(err)
      const gone = err instanceof ApiError && err.status === 404
      if (holder === null && !gone) return false // network blip: keep going
      // 404 = permission gone (B7): still drop our row right away (release
      // only ever deletes the caller's own lock) so others aren't blocked
      // until the 90 s expiry.
      if (gone && opsRef.current) {
        void Promise.resolve(opsRef.current.release(false)).catch(() => {})
      }
      opsRef.current = null
      set('off')
      onLostRef.current(holder)
      return true
    },
    [set],
  )

  const start = useCallback(
    async (ops: LockOps, takeover = false) => {
      await ops.acquire(takeover)
      opsRef.current = ops
      lastActivity.current = Date.now()
      set('held')
    },
    [set],
  )

  const stop = useCallback(() => {
    const ops = opsRef.current
    opsRef.current = null
    if (ops && statusRef.current === 'held') {
      void Promise.resolve(ops.release(false)).catch(() => {})
    }
    set('off')
  }, [set])

  /**
   * Make sure we hold the lock right now (before a save): re-acquires after
   * an idle release. `lost` → `onLost` already ran; `error` → network or
   * other failure (still editing, try again).
   */
  const ensure = useCallback(async (): Promise<'held' | 'lost' | 'error'> => {
    const ops = opsRef.current
    if (!ops) return 'lost'
    if (statusRef.current === 'held') return 'held'
    try {
      await ops.acquire(false)
      lastActivity.current = Date.now()
      set('held')
      return 'held'
    } catch (err) {
      return lose(err) ? 'lost' : 'error'
    }
  }, [lose, set])

  /** Mark user activity; re-acquires after an idle release. */
  const touch = useCallback(() => {
    lastActivity.current = Date.now()
    const ops = opsRef.current
    if (statusRef.current !== 'paused' || !ops || reacquiring.current) return
    reacquiring.current = true
    ops
      .acquire(false)
      .then(() => set('held'))
      .catch((err) => {
        if (!lose(err)) set('paused')
      })
      .finally(() => {
        reacquiring.current = false
      })
  }, [lose, set])

  // Heartbeat + idle release while held.
  useEffect(() => {
    if (status !== 'held') return
    const beat = window.setInterval(() => {
      const ops = opsRef.current
      if (!ops || statusRef.current !== 'held') return
      ops.acquire(false).catch((err) => {
        lose(err)
      })
    }, LOCK_HEARTBEAT_MS)
    const idle = window.setInterval(() => {
      const ops = opsRef.current
      if (!ops || statusRef.current !== 'held') return
      if (Date.now() - lastActivity.current >= LOCK_IDLE_MS) {
        void Promise.resolve(ops.release(false)).catch(() => {})
        set('paused')
      }
    }, 15_000)
    return () => {
      window.clearInterval(beat)
      window.clearInterval(idle)
    }
  }, [status, lose, set])

  // Any key / pointer press while editing counts as activity.
  useEffect(() => {
    if (status === 'off') return
    const onActivity = () => touch()
    window.addEventListener('keydown', onActivity, true)
    window.addEventListener('pointerdown', onActivity, true)
    return () => {
      window.removeEventListener('keydown', onActivity, true)
      window.removeEventListener('pointerdown', onActivity, true)
    }
  }, [status, touch])

  // Leaving the page (tab close / reload / navigation away): release with
  // keepalive. Unmount covers in-app navigation.
  useEffect(() => {
    const onPageHide = () => {
      const ops = opsRef.current
      if (ops && statusRef.current === 'held') void ops.release(true)
    }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      onPageHide()
    }
  }, [])

  return { status, start, stop, touch, ensure }
}
