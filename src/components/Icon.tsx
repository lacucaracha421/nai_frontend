/** Stroke icons shared by the main screen and viewer (paths from the B2 prototype). */
const PATHS = {
  save: <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />,
  seed: <path d="M12 20v-7M12 13c0-4 3-6.5 7-6.5 0 4-3 6.5-7 6.5zM12 15c0-3-2.3-5-5.5-5 0 3 2.3 5 5.5 5z" />,
  upscale: <path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" />,
  sparkle: <path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>,
  eyeoff: <path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.7A9.6 9.6 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 01-2.6 3.3M6.2 7.2C3.9 8.8 2.5 12 2.5 12S6 18.5 12 18.5c1.4 0 2.7-.3 3.8-.8" />,
  cog: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></>,
  undo: <><path d="M9 7L4.5 11.5 9 16" /><path d="M4.5 11.5H15a4.5 4.5 0 010 9h-3" /></>,
  redo: <><path d="M15 7l4.5 4.5L15 16" /><path d="M19.5 11.5H9a4.5 4.5 0 000 9h3" /></>,
  translate: <><path d="M4 6h9M8.5 4v2M6 6c.5 3 2.5 5.5 5.5 7M11 6c-.6 3.5-3 6.5-6.5 8" /><path d="M13 20l3.5-8.5L20 20M14.3 17h4.4" /></>,
  book: <path d="M4 5h5.5A2.5 2.5 0 0112 7.5V20a2 2 0 00-2-2H4zM20 5h-5.5A2.5 2.5 0 0012 7.5V20a2 2 0 012-2h6z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  left: <path d="M15 5l-7 7 7 7" />,
  right: <path d="M9 5l7 7-7 7" />,
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />,
  sliders: <><path d="M4 7h9M18 7h2M4 17h3M11 17h9" /><rect x="13" y="5" width="4" height="4" rx="1" /><rect x="7" y="15" width="4" height="4" rx="1" /></>,
  expand: <path d="M14 4h6v6M10 20H4v-6M20 4l-6 6M4 20l6-6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  more: <><circle cx="6" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="18" cy="12" r="1.2" fill="currentColor" /></>,
  dice: <><rect x="4" y="4" width="16" height="16" rx="3.5" /><circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" /><circle cx="15.5" cy="15.5" r="1.1" fill="currentColor" /><circle cx="12" cy="12" r="1.1" fill="currentColor" /></>,
  user: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c0-3.8 3.1-6.5 7-6.5s7 2.7 7 6.5" /></>,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg className={`ui-icon ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
