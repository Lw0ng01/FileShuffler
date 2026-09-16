import { DashboardIcon, SettingsIcon, ShuffleIcon, StatsIcon } from './Icons'

export type Page = 'shuffle' | 'dashboard' | 'stats'

interface Props {
  page: Page
  onNavigate: (page: Page) => void
}

export function Sidebar({ page, onNavigate }: Props): React.JSX.Element {
  return (
    <nav className="sidebar" aria-label="Main">
      <div className="brand">
        <span className="brand-mark">
          <ShuffleIcon size={16} />
        </span>
        FileShuffler
      </div>
      <button
        className="nav-item"
        aria-current={page === 'shuffle' ? 'page' : undefined}
        onClick={() => onNavigate('shuffle')}
      >
        <ShuffleIcon />
        Shuffle
      </button>
      <button
        className="nav-item"
        aria-current={page === 'dashboard' ? 'page' : undefined}
        onClick={() => onNavigate('dashboard')}
      >
        <DashboardIcon />
        Dashboard
      </button>
      <button
        className="nav-item"
        aria-current={page === 'stats' ? 'page' : undefined}
        onClick={() => onNavigate('stats')}
      >
        <StatsIcon />
        Stats
      </button>
      <button className="nav-item" disabled title="Planned for a later phase">
        <SettingsIcon />
        Settings
        <span className="soon">Soon</span>
      </button>
    </nav>
  )
}
