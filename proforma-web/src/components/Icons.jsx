// Lightweight inline SVG icon components. Named exports, no external deps.
// All icons share a 24-viewBox with stroke-only paths so they scale cleanly
// and inherit surrounding text color via currentColor.

function Ico({ size = 16, color, style, children }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color || "currentColor"}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, ...style }}
    >
      {children}
    </svg>
  );
}

export function PhoneIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.11 9.88 19.79 19.79 0 0 1 3.08 4.18 2 2 0 0 1 5.06 2h3a2 2 0 0 1 2 1.72c.127.96.36 1.903.7 2.81a2 2 0 0 1-.45 2.11L9.09 9.91A16 16 0 0 0 15 15.91l1.27-1.27a2 2 0 0 1 2.11-.45c.907.34 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </Ico>
  );
}

export function BuildingIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <rect x="4" y="2" width="16" height="20" rx="1" />
      <path d="M9 22V12h6v10" />
      <path d="M9 7h.01M15 7h.01M9 12h.01M15 12h.01" />
    </Ico>
  );
}

export function MapPinIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </Ico>
  );
}

export function WarningIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </Ico>
  );
}

export function ClipboardIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" />
    </Ico>
  );
}

export function MailIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </Ico>
  );
}

export function GlobeIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </Ico>
  );
}

export function FolderIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </Ico>
  );
}

export function BookIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </Ico>
  );
}

export function FileIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </Ico>
  );
}

export function PencilIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </Ico>
  );
}

export function RefreshIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </Ico>
  );
}

export function DownloadIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <polyline points="8 17 12 21 16 17" />
      <line x1="12" y1="3" x2="12" y2="21" />
    </Ico>
  );
}

export function TrashIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </Ico>
  );
}

export function CalendarIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </Ico>
  );
}

export function SearchIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </Ico>
  );
}

export function MicIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </Ico>
  );
}

export function TagIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </Ico>
  );
}

export function UserIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </Ico>
  );
}

export function TargetIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </Ico>
  );
}

export function BellIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </Ico>
  );
}

export function BellOffIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      <path d="M18.63 13A17.89 17.89 0 0 1 18 8" />
      <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
      <path d="M18 8a6 6 0 0 0-9.33-5" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </Ico>
  );
}

export function HamburgerIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </Ico>
  );
}

export function HourglassIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <path d="M5 22h14" />
      <path d="M5 2h14" />
      <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
      <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
    </Ico>
  );
}

export function UsersIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Ico>
  );
}

export function DollarIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </Ico>
  );
}

export function BriefcaseIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </Ico>
  );
}

export function PaperclipIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </Ico>
  );
}

export function CheckIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <polyline points="20 6 9 17 4 12" />
    </Ico>
  );
}

export function HomeIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </Ico>
  );
}

export function ChatIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </Ico>
  );
}

export function FlagIcon({ size, color, style } = {}) {
  return (
    <Ico size={size} color={color} style={style}>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </Ico>
  );
}

export function CloseIcon({ size, color, style } = {}) {
  return (
    <svg
      width={size || 12}
      height={size || 12}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color || "currentColor"}
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
      style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, ...style }}
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
