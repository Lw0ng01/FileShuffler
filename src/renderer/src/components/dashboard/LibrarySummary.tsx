import type { LibraryView } from '../../../../shared/library'
import { formatBytes, formatCount } from '../../format'
import { CATEGORY_LABELS, CATEGORY_ORDER } from './labels'

/** Everything indexed, split by category. */
export function Totals({ view }: { view: LibraryView }): React.JSX.Element {
  const totals = CATEGORY_ORDER.map(
    (category) =>
      view.totals.find((total) => total.category === category) ?? {
        category,
        files: 0,
        bytes: 0
      }
  )
  return (
    <div className="card">
      <p className="eyebrow">Indexed</p>
      <p className="now-title">
        {formatBytes(view.bytes)} <span className="muted">· {formatCount(view.files)}</span>
      </p>
      <div className="split" role="img" aria-label="Space by category">
        {totals.map((total) => (
          <div
            key={total.category}
            className={`split-part ${total.category}`}
            style={{ flexGrow: Math.max(total.bytes, view.bytes === 0 ? 1 : 0) }}
            title={`${CATEGORY_LABELS[total.category]}: ${formatBytes(total.bytes)}`}
          />
        ))}
      </div>
      <ul className="legend">
        {totals.map((total) => (
          <li key={total.category}>
            <span className={`legend-dot ${total.category}`} />
            {CATEGORY_LABELS[total.category]}
            <span className="muted">
              {' '}
              {formatBytes(total.bytes)} · {formatCount(total.files)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** One card per drive: free space, and how much of it is indexed. */
export function Drives({ view }: { view: LibraryView }): React.JSX.Element | null {
  if (view.drives.length === 0) return null
  return (
    <section className="dash-section" aria-label="Drives">
      <h2 className="section-title">Drives</h2>
      <div className="drive-grid">
        {view.drives.map((drive) => {
          const known = drive.total !== null && drive.free !== null
          const used = known ? (drive.total as number) - (drive.free as number) : 0
          const usedPercent = known ? Math.min(100, (used / (drive.total as number)) * 100) : 0
          const indexedPercent = known
            ? Math.min(100, (drive.bytes / (drive.total as number)) * 100)
            : 0
          return (
            <div className="card drive-card" key={drive.drive}>
              <p className="eyebrow">{drive.drive}</p>
              {known ? (
                <>
                  <p className="drive-line">
                    {formatBytes(drive.free as number)} free
                    <span className="muted"> of {formatBytes(drive.total as number)}</span>
                  </p>
                  <div
                    className="meter"
                    role="img"
                    aria-label={`${Math.round(usedPercent)}% of ${drive.drive} used`}
                  >
                    <div className="meter-used" style={{ width: `${usedPercent}%` }} />
                    <div className="meter-indexed" style={{ width: `${indexedPercent}%` }} />
                  </div>
                </>
              ) : (
                <p className="drive-line muted">Size unavailable</p>
              )}
              <p className="muted">
                {formatBytes(drive.bytes)} indexed · {formatCount(drive.files)}
              </p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
