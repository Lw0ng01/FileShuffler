import { useEffect, useMemo, useState } from 'react'
import type {
  Appearance,
  ClearableData,
  PlayerChoice,
  SettingsView
} from '../../../shared/settings'

export interface SettingsActions {
  chooseMpv: () => void
  useDefaultMpv: () => void
  testMpv: () => void
  setAppearance: (value: Appearance) => void
  setPlayer: (value: PlayerChoice) => void
  clearData: (what: ClearableData) => void
}

/** Electron prefixes errors thrown in the main process; keep only the useful part. */
function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/**
 * The Settings view from the main process and its actions. Presentation only: choosing and
 * testing mpv, and erasing data, all happen in main.
 */
export function useSettings(): {
  view: SettingsView | null
  error: string | null
  actions: SettingsActions
} {
  const [view, setView] = useState<SettingsView | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const api = window.api.settings
    let active = true
    const unsubscribe = api.onView((next) => {
      if (active) setView(next)
    })
    api
      .getView()
      .then((initial) => {
        if (active) setView((current) => current ?? initial)
      })
      .catch((caught: unknown) => {
        if (active) setError(cleanError(caught))
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const actions = useMemo<SettingsActions>(() => {
    const api = window.api.settings
    const run = (task: () => Promise<SettingsView>): void => {
      setError(null)
      task()
        .then(setView)
        .catch((caught: unknown) => setError(cleanError(caught)))
    }
    return {
      chooseMpv: () => run(() => api.chooseMpv()),
      useDefaultMpv: () => run(() => api.useDefaultMpv()),
      testMpv: () => run(() => api.testMpv()),
      setAppearance: (value) => run(() => api.setAppearance(value)),
      setPlayer: (value) => run(() => api.setPlayer(value)),
      clearData: (what) => run(() => api.clearData(what))
    }
  }, [])

  return { view, error, actions }
}
