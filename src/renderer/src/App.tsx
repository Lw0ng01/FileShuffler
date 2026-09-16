import { useState } from 'react'
import { DashboardScreen } from './components/DashboardScreen'
import { ShufflerScreen } from './components/ShufflerScreen'
import { Sidebar, type Page } from './components/Sidebar'
import { StatsScreen } from './components/StatsScreen'
import { useLibrary } from './hooks/useLibrary'
import { useShuffler } from './hooks/useShuffler'
import { useStats } from './hooks/useStats'

function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('shuffle')
  const { view, actions, actionError, actionNotice } = useShuffler()
  // Both hooks stay subscribed while the app is open, so switching screens shows current state
  // rather than reloading it. A shuffle keeps running while the dashboard is on screen.
  const library = useLibrary()
  const stats = useStats()

  return (
    <div className="app">
      <Sidebar page={page} onNavigate={setPage} />
      <main className="main">
        {page === 'stats' ? (
          <StatsScreen
            view={stats.view}
            favorites={stats.favorites}
            neverPlayed={stats.neverPlayed}
            error={stats.error}
            actions={stats.actions}
            fileActions={library.actions}
          />
        ) : page === 'dashboard' ? (
          <DashboardScreen
            view={library.view}
            largest={library.largest}
            recent={library.recent}
            results={library.results}
            filters={library.filters}
            error={library.error}
            cleanup={library.cleanup}
            actions={library.actions}
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
