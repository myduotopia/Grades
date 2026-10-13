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
 * "○○ is editing" or ask to take over, and resolves false when editing was
 * cancelled while it was in flight), `stop()` on save / cancel, and get
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
  /**
   * Bumped whenever the editing session ends (stop / lost / unmount). An
   * acquire that was in flight when that happened sees a different value on
   * return: it must not touch state, and must release the lock it just got
   * so no phantom lock blocks others until expiry.
   */
  const gen = useRef(0)
  const onLostRef = useRef(onLost)
  onLostRef.current = onLost

  const set = useCallback((s: EditLockStatus) => {
    statusRef.current = s
    setStatus(s)
  }, [])

  /**
   * An acquire returned after its editing session ended (`gen` moved on):
   * give that lock straight back — unless a new session has already
   * started, whose lock (same holder, same row) we must not delete.
   */
  const releaseStale = useCallback((ops: LockOps) => {
    if (opsRef.current) return
    void Promise.resolve(ops.release(false)).catch(() => {})
  }, [])

  const lose = useCallback(
    (err: unknown) => {
      const holder = lockHolderFromError(err)
      // 404 = permission gone (B7); 403 = term archived meanwhile (B9).
      const gone =
        err instanceof ApiError && (err.status === 404 || err.status === 403)
      if (holder === null && !gone) return false // network blip: keep going
      // Still drop our row right away (release only ever deletes the
      // caller's own lock) so others aren't blocked until the 90 s expiry.
      if (gone && opsRef.current) {
        void Promise.resolve(opsRef.current.release(false)).catch(() => {})
      }
      gen.current += 1
      opsRef.current = null
      set('off')
      onLostRef.current(holder)
      return true
    },
    [set],
  )

  /**
   * Resolves true once the lock is held; false when `stop()` / unmount
   * happened while the request was in flight (the lock just obtained is
   * released again — the caller should simply do nothing).
   */
  const start = useCallback(
    async (ops: LockOps, takeover = false): Promise<boolean> => {
      const g = gen.current
      await ops.acquire(takeover)
      if (gen.current !== g) {
        releaseStale(ops)
        return false
      }
      opsRef.current = ops
      lastActivity.current = Date.now()
      set('held')
      return true
    },
    [releaseStale, set],
  )

  const stop = useCallback(() => {
    gen.current += 1
    const ops = opsRef.current
    opsRef.current = null
    // Release when held, and also when paused: a re-acquire may be in
    // flight; releasing a lock we don't hold is a harmless no-op.
    if (ops && statusRef.current !== 'off') {
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
    const g = gen.current
    try {
      await ops.acquire(false)
      if (gen.current !== g) {
        releaseStale(ops)
        return 'lost'
      }
      lastActivity.current = Date.now()
      set('held')
      return 'held'
    } catch (err) {
      if (gen.current !== g) return 'lost'
      return lose(err) ? 'lost' : 'error'
    }
  }, [lose, releaseStale, set])

  /** Mark user activity; re-acquires after an idle release. */
  const touch = useCallback(() => {
    lastActivity.current = Date.now()
    const ops = opsRef.current
    if (statusRef.current !== 'paused' || !ops || reacquiring.current) return
    reacquiring.current = true
    const g = gen.current
    ops
      .acquire(false)
      .then(() => {
        if (gen.current !== g) {
          // Editing ended while re-acquiring: give the lock straight back.
          releaseStale(ops)
          return
        }
        set('held')
      })
      .catch((err) => {
        if (gen.current !== g) return
        if (!lose(err)) set('paused')
      })
      .finally(() => {
        reacquiring.current = false
      })
  }, [lose, releaseStale, set])

  // Heartbeat + idle release while held.
  useEffect(() => {
    if (status !== 'held') return
    const beat = window.setInterval(() => {
      const ops = opsRef.current
      if (!ops || statusRef.current !== 'held') return
      const g = gen.current
      ops.acquire(false).then(
        () => {
          // Stopped while the beat was in flight: it may have re-created
          // the lock we just released.
          if (gen.current !== g) releaseStale(ops)
        },
        (err) => {
          if (gen.current === g) lose(err)
        },
      )
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
  }, [status, lose, releaseStale, set])

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
      // Unmounted: an acquire still in flight must release, not resurrect.
      gen.current += 1
      opsRef.current = null
    }
  }, [])

  return { status, start, stop, touch, ensure }
}
