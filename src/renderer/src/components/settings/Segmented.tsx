/** A row of mutually exclusive choices, such as Automatic / Light / Dark. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange
}: {
  /** Names the group for assistive technology. */
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          className={`segment${value === option.value ? ' on' : ''}`}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
