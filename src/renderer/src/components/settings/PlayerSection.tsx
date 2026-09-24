import type { MpvSource, PlayerChoice, SettingsView } from '../../../../shared/settings'
import type { SettingsActions } from '../../hooks/useSettings'
import { Segmented } from './Segmented'

const PLAYERS: { value: PlayerChoice; label: string; detail: string }[] = [
  {
    value: 'builtin',
    label: 'Built-in',
    detail:
      "Plays inside the app, with its own controls and fullscreen. The few formats it can't decode open in your computer's default video player."
  },
  {
    value: 'mpv',
    label: 'mpv',
    detail:
      "Opens videos in mpv's own window instead. For people who already use mpv: it is installed separately, and plays nearly every format."
  }
]

const SOURCE_LABELS: Record<MpvSource, string> = {
  environment: 'Set by the FILESHUFFLER_MPV environment variable',
  settings: 'Chosen here',
  installed: 'Found in a standard install location',
  path: 'Looked up on the system PATH'
}

interface Props {
  view: SettingsView
  actions: SettingsActions
}

export function PlayerSection({ view, actions }: Props): React.JSX.Element {
  return (
    <section className="dash-section" aria-label="Player">
      <h2 className="section-title">Player</h2>
      <p className="muted">{PLAYERS.find((p) => p.value === view.player)?.detail}</p>
      <Segmented
        label="Player"
        options={PLAYERS}
        value={view.player}
        onChange={actions.setPlayer}
      />
      {/* Only once mpv is chosen. The built-in player is the default and needs nothing set up,
          so an mpv path, a Test button and "Looked up on the system PATH" were the first thing
          everyone saw here - about a program most people have never installed. */}
      {view.player === 'mpv' && <MpvCard mpv={view.mpv} actions={actions} />}
    </section>
  )
}

/** Which mpv will run, where it was found, and whether it works. */
function MpvCard({
  mpv,
  actions
}: {
  mpv: SettingsView['mpv']
  actions: SettingsActions
}): React.JSX.Element {
  return (
    <div className="card settings-card">
      <p className="eyebrow">mpv</p>
      <p className="setting-path" title={mpv.path}>
        {mpv.path}
      </p>
      <p className="muted">{SOURCE_LABELS[mpv.source]}</p>
      {mpv.test !== null && (
        <p className={mpv.test.ok ? 'ok-text' : 'warning-text'}>
          {mpv.test.ok ? `Works: ${mpv.test.message}` : `Doesn't work: ${mpv.test.message}`}
        </p>
      )}
      <div className="settings-actions">
        <button className="btn btn-small" onClick={actions.chooseMpv}>
          Choose mpv…
        </button>
        <button className="btn btn-small" onClick={actions.testMpv} disabled={mpv.testing}>
          {mpv.testing ? 'Testing…' : 'Test'}
        </button>
        {mpv.chosen !== null && (
          <button className="btn btn-small" onClick={actions.useDefaultMpv}>
            Find automatically
          </button>
        )}
      </div>
      {mpv.source === 'environment' && (
        <p className="muted">FILESHUFFLER_MPV is set, so it overrides any choice made here.</p>
      )}
    </div>
  )
}
