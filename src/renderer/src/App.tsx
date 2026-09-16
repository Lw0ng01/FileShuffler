import { useState } from 'react'
import { DashboardScreen } from './components/DashboardScreen'
import { ShufflerScreen } from './components/ShufflerScreen'
import { Sidebar, type Page } from './components/Sidebar'
import { useLibrary } from './hooks/useLibrary'
import { useShuffler } from './hooks/useShuffler'

function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('shuffle')
  const { view, actions, actionError, actionNotice } = useShuffler()
  // Both hooks stay subscribed while the app is open, so switching screens shows current state
  // rather than reloading it. A shuffle keeps running while the dashboard is on screen.
  const library = useLibrary()

  return (
    <div className="app">
      <Sidebar page={page} onNavigate={setPage} />
      <main className="main">
        {page === 'dashboard' ? (
          <DashboardScreen
            view={library.view}
            largest={library.largest}
            recent={library.recent}
            results={library.results}
            term={library.term}
            error={library.error}
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
