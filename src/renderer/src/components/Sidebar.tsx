import { DashboardIcon, SettingsIcon, ShuffleIcon } from './Icons'

export function Sidebar(): React.JSX.Element {
  return (
    <nav className="sidebar" aria-label="Main">
      <div className="brand">
        <span className="brand-mark">
          <ShuffleIcon size={16} />
        </span>
        FileShuffler
      </div>
      <button className="nav-item" aria-current="page">
        <ShuffleIcon />
        Shuffle
      </button>
      <button className="nav-item" disabled title="Planned for a later phase">
        <DashboardIcon />
        Dashboard
        <span className="soon">Soon</span>
      </button>
      <button className="nav-item" disabled title="Planned for a later phase">
        <SettingsIcon />
        Settings
        <span className="soon">Soon</span>
      </button>
    </nav>
  )
}
