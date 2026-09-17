import { useState } from 'react'
import { CleanupScreen } from './components/CleanupScreen'
import { DashboardScreen } from './components/DashboardScreen'
import { SettingsScreen } from './components/SettingsScreen'
import { ShufflerScreen } from './components/ShufflerScreen'
import { Sidebar, type Page } from './components/Sidebar'
import { StatsScreen } from './components/StatsScreen'
import { useLibrary } from './hooks/useLibrary'
import { useSettings } from './hooks/useSettings'
import { useShuffler } from './hooks/useShuffler'
import { useStats } from './hooks/useStats'

function App(): React.JSX.Element {
  // The dashboard is the app's home: it says what the library holds, and a shuffle starts from a
  // folder rather than from the app opening.
  const [page, setPage] = useState<Page>('dashboard')
  const { view, actions, actionError, actionNotice } = useShuffler()
  // Every hook stays subscribed while the app is open, so switching screens shows current state
  // rather than reloading it. A shuffle keeps running while another screen is showing.
  const library = useLibrary()
  const stats = useStats()
  const settings = useSettings()

  return (
    <div className="app">
      <Sidebar page={page} onNavigate={setPage} />
      <main className="main">
        {page === 'settings' ? (
          <SettingsScreen
            view={settings.view}
            error={settings.error}
            actions={settings.actions}
            library={library.view}
            libraryActions={library.actions}
          />
        ) : page === 'stats' ? (
          <StatsScreen
            view={stats.view}
            favorites={stats.favorites}
            neverPlayed={stats.neverPlayed}
            error={stats.error}
            actions={stats.actions}
            fileActions={library.actions}
          />
        ) : page === 'cleanup' ? (
          <CleanupScreen cleanup={library.cleanup} actions={library.actions} />
        ) : page === 'dashboard' ? (
          <DashboardScreen
            view={library.view}
            largest={library.largest}
            recent={library.recent}
            results={library.results}
            filters={library.filters}
            error={library.error}
            actions={library.actions}
            onManageFolders={() => setPage('settings')}
          />
        ) : view === null ? (
          <p className="loading">Loading…</p>
        ) : (
          <ShufflerScreen
            view={view}
            actions={actions}
            actionError={actionError}
            actionNotice={actionNotice}
          />
        )}
      </main>
    </div>
  )
}

export default App
