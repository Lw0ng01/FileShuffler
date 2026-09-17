import type { LibrarySort, LibraryView } from '../../../../shared/library'
import { filtersActive, type LibraryActions, type SearchFilters } from '../../hooks/useLibrary'
import { CATEGORY_LABELS, CATEGORY_ORDER } from './labels'

const SIZE_OPTIONS: { label: string; bytes: number | null }[] = [
  { label: 'Any size', bytes: null },
  { label: 'Over 10 MB', bytes: 10 * 1024 ** 2 },
  { label: 'Over 100 MB', bytes: 100 * 1024 ** 2 },
  { label: 'Over 1 GB', bytes: 1024 ** 3 },
  { label: 'Over 4 GB', bytes: 4 * 1024 ** 3 }
]

const SORT_LABELS: Record<LibrarySort, string> = {
  modified: 'Date changed',
  size: 'Size',
  name: 'Name'
}

/** Says the direction in words that fit the sort, rather than a bare "ascending". */
function directionLabel(sort: LibrarySort, direction: 'asc' | 'desc'): string {
  if (sort === 'name') return direction === 'asc' ? 'A to Z' : 'Z to A'
  if (sort === 'size') return direction === 'desc' ? 'Largest first' : 'Smallest first'
  return direction === 'desc' ? 'Newest first' : 'Oldest first'
}

/** Category chips, drive, size and sort for searching the index. */
export function FilterBar({
  view,
  filters,
  actions
}: {
  view: LibraryView
  filters: SearchFilters
  actions: LibraryActions
}): React.JSX.Element {
  return (
    <div className="filters">
      <div className="chips" role="group" aria-label="Categories">
        {CATEGORY_ORDER.map((category) => {
          const on = filters.categories.includes(category)
          return (
            <button
              key={category}
              className={`chip${on ? ' on' : ''}`}
              aria-pressed={on}
              onClick={() => actions.toggleCategory(category)}
            >
              <span className={`legend-dot ${category}`} />
              {CATEGORY_LABELS[category]}
            </button>
          )
        })}
      </div>
      <select
        className="select"
        aria-label="Drive"
        value={filters.drive ?? ''}
        onChange={(event) =>
          actions.setDrive(event.target.value === '' ? null : event.target.value)
        }
      >
        <option value="">All drives</option>
        {view.drives.map((drive) => (
          <option key={drive.drive} value={drive.drive}>
            {drive.drive}
          </option>
        ))}
      </select>
      <select
        className="select"
        aria-label="Size"
        value={filters.minSize === null ? '' : String(filters.minSize)}
        onChange={(event) =>
          actions.setMinSize(event.target.value === '' ? null : Number(event.target.value))
        }
      >
        {SIZE_OPTIONS.map((option) => (
          <option key={option.label} value={option.bytes === null ? '' : String(option.bytes)}>
            {option.label}
          </option>
        ))}
      </select>
      <select
        className="select"
        aria-label="Sort by"
        value={filters.sort}
        onChange={(event) => actions.setSort(event.target.value as LibrarySort)}
      >
        {(Object.keys(SORT_LABELS) as LibrarySort[]).map((sort) => (
          <option key={sort} value={sort}>
            {SORT_LABELS[sort]}
          </option>
        ))}
      </select>
      <button className="btn btn-small" onClick={actions.toggleDirection}>
        {directionLabel(filters.sort, filters.direction)}
      </button>
      {filtersActive(filters) && (
        <button className="btn btn-small" onClick={actions.clearFilters}>
          Clear
        </button>
      )}
    </div>
  )
}
