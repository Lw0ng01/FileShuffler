import { useState } from 'react'
import type { ClearableData } from '../../../../shared/settings'

interface Clearable {
  what: ClearableData
  title: string
  detail: string
}

const CLEARABLE: Clearable[] = [
  {
    what: 'plays',
    title: 'Play history',
    detail: 'Every play and finish the Stats tab counts. Favorites stay.'
  },
  {
    what: 'favorites',
    title: 'Favorites',
    detail: 'Your starred files. Play history stays.'
  },
  {
    what: 'progress',
    title: 'Saved shuffle progress',
    detail: "Where each folder's cycle got to, and which folder reopens at startup."
  },
  {
    what: 'index',
    title: 'The index',
    detail: 'Everything catalogued from your folders. The folder list stays, so a scan rebuilds it.'
  }
]

interface Props {
  /** The index can't be cleared while a scan is writing to it. */
  scanning: boolean
  onClear: (what: ClearableData) => void
}

/** One button per kind of saved data, each clearing only its own. */
export function PrivacySection({ scanning, onClear }: Props): React.JSX.Element {
  return (
    <section className="dash-section" aria-label="Privacy">
      <h2 className="section-title">Privacy</h2>
      <p className="muted">
        All of this stays on this computer. Clearing one kind of data never touches the others, and
        never touches your files.
      </p>
      <ul className="roots">
        {CLEARABLE.map((item) => (
          <ClearRow
            key={item.what}
            item={item}
            disabled={item.what === 'index' && scanning}
            onClear={() => onClear(item.what)}
          />
        ))}
      </ul>
    </section>
  )
}

function ClearRow({
  item,
  disabled,
  onClear
}: {
  item: Clearable
  disabled: boolean
  onClear: () => void
}): React.JSX.Element {
  // Clearing can't be undone, so it asks first rather than acting on one click.
  const [confirming, setConfirming] = useState(false)
  return (
    <li className="root-row">
      <span className="clear-text">
        <span className="root-path">{item.title}</span>
        <span className="muted">{item.detail}</span>
      </span>
      {confirming ? (
        <span className="settings-actions">
          <span className="muted">This can&rsquo;t be undone.</span>
          <button
            className="btn btn-small btn-danger"
            onClick={() => {
              setConfirming(false)
              onClear()
            }}
          >
            Clear
          </button>
          <button className="btn btn-small" onClick={() => setConfirming(false)}>
            Keep
          </button>
        </span>
      ) : (
        <button
          className="btn btn-small"
          onClick={() => setConfirming(true)}
          disabled={disabled}
          title={disabled ? 'Stop the scan first' : undefined}
        >
          Clear…
        </button>
      )}
    </li>
  )
}
