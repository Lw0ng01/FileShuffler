import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ShufflerView, UndoResult } from '../../../shared/shuffler'

export interface ShufflerActions {
  chooseFolder: () => void
  play: () => void
  next: () => void
  back: () => void
  deleteCurrent: () => void
  undoDelete: (id: string) => void
}

/** How long a confirmation like "Restored clip.mkv" stays on screen. */
const NOTICE_MS = 4000

/** Electron prefixes errors thrown in the main process; keep only the useful part. */
function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** Undo gives no visible result on its own, so say what it did (PROJECT.md §6). */
function undoMessage(result: UndoResult, id: string): string {
  switch (result) {
    case 'restored':
      return `Restored ${id}`
    case 'trashing':
      return `Too late: ${id} is already being moved to the trash`
    case 'unknown':
      return `${id} is no longer waiting to be deleted`
  }
}

/** The latest shuffler view from the main process, plus actions that report their own outcome. */
export function useShuffler(): {
  view: ShufflerView | null
  actions: ShufflerActions
  actionError: string | null
  actionNotice: string | null
} {
  const [view, setView] = useState<ShufflerView | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearNoticeTimer = useCallback((): void => {
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
    noticeTimer.current = null
  }, [])

  const showNotice = useCallback(
    (text: string): void => {
      clearNoticeTimer()
      setActionNotice(text)
      noticeTimer.current = setTimeout(() => setActionNotice(null), NOTICE_MS)
    },
    [clearNoticeTimer]
  )

  useEffect(() => clearNoticeTimer, [clearNoticeTimer])

  useEffect(() => {
    const api = window.api.shuffler
    let active = true
    const unsubscribe = api.onView((next) => {
      if (active) setView(next)
    })
    api
      .getView()
      .then((initial) => {
        // A pushed update may already have arrived; never overwrite it with an older snapshot.
        if (active) setView((current) => current ?? initial)
      })
      .catch((error: unknown) => {
        if (active) setActionError(cleanError(error))
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const actions = useMemo<ShufflerActions>(() => {
    const api = window.api.shuffler
    const run = (task: () => Promise<unknown>): void => {
      setActionError(null)
      clearNoticeTimer()
      setActionNotice(null)
      task().catch((error: unknown) => setActionError(cleanError(error)))
    }
    return {
      chooseFolder: () => run(() => api.chooseFolder()),
      play: () => run(() => api.play()),
      next: () => run(() => api.next()),
      back: () => run(() => api.back()),
      deleteCurrent: () => run(() => api.deleteCurrent()),
      undoDelete: (id) =>
        run(async () => {
          showNotice(undoMessage(await api.undoDelete(id), id))
        })
    }
  }, [clearNoticeTimer, showNotice])

  return { view, actions, actionError, actionNotice }
}
