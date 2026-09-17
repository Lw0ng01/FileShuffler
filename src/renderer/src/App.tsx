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
  // Whether anything has scrolled under the pinned header, which is the only thing that decides
  // whether it draws its edge. At rest there is no line, so the screens look as they did before
  // the header was pinned. React bails out when the value has not changed, so scrolling does not
  // re-render on every event.
  const [scrolled, setScrolled] = useState(false)
  const { view, actions, actionError, actionNotice } = useShuffler()
  // Every hook stays subscribed while the app is open, so switching screens shows current state
  // rather than reloading it. A shuffle keeps running while another screen is showing.
  const library = useLibrary()
  const stats = useStats()
  const settings = useSettings()

  return (
    <div className="app">
      <Sidebar page={page} onNavigate={setPage} />
      <main
        className="main"
        data-scrolled={scrolled}
        onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
      >
        {/* With no title bar there is nothing along the top of the window to grab, and the sidebar
            alone is an odd place to have to reach for. This strip is the handle: it spans the whole
            width of the screen area, stays put while the content scrolls under it, and doubles as
            the clearance the window controls need. Presentation only, so it is hidden from
            assistive technology. */}
        <div className="titlebar" aria-hidden="true" />
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
