import { ShufflerScreen } from './components/ShufflerScreen'
import { Sidebar } from './components/Sidebar'
import { useShuffler } from './hooks/useShuffler'

function App(): React.JSX.Element {
  const { view, actions, actionError, actionNotice } = useShuffler()

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        {view === null ? (
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
