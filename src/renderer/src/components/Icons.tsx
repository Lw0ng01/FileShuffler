interface IconProps {
  size?: number
}

function Svg({
  size = 18,
  children
}: IconProps & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function ShuffleIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M16 3h5v5" />
      <path d="M4 20 21 3" />
      <path d="M21 16v5h-5" />
      <path d="m15 15 6 6" />
      <path d="M4 4l5 5" />
    </Svg>
  )
}

export function DashboardIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </Svg>
  )
}

export function SettingsIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M4 7h10" />
      <path d="M18 7h2" />
      <circle cx="16" cy="7" r="2" />
      <path d="M4 17h2" />
      <path d="M10 17h10" />
      <circle cx="8" cy="17" r="2" />
    </Svg>
  )
}

export function FolderIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Svg>
  )
}

export function BackIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M19 20 9 12l10-8z" />
      <path d="M5 19V5" />
    </Svg>
  )
}

export function NextIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="m5 4 10 8-10 8z" />
      <path d="M19 5v14" />
    </Svg>
  )
}

export function TrashIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
    </Svg>
  )
}

export function PlayIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="m7 4 13 8-13 8z" />
    </Svg>
  )
}
