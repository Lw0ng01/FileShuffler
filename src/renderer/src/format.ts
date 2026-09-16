/** Display formatting shared by the screens, so every tab says sizes and times the same way. */

/** Sizes people recognise: 1.2 GB rather than 1288490189. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** power
  return `${value >= 100 || power === 0 ? Math.round(value) : value.toFixed(1)} ${units[power]}`
}

export function formatCount(count: number, singular = 'file', plural = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`
}

/** "just now", "5 min ago", "3 h ago", then a date. `never` is shown when there's no time. */
export function formatWhen(time: number | null, never = 'never'): string {
  if (time === null) return never
  const minutes = Math.round((Date.now() - time) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(time).toLocaleDateString()
}

/** Shortens a long path for display; the full one stays in the tooltip. */
export function shortenPath(path: string): string {
  const separator = path.includes('\\') ? '\\' : '/'
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.length <= 3 ? path : `…${separator}${parts.slice(-2).join(separator)}`
}
