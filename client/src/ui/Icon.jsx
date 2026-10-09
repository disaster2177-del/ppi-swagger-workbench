/** Stroke icons drawn on a 16px grid. One set for the whole app. */
const PATHS = {
  sidebarLeft: 'M2.5 3.5h11v9h-11z M6 3.5v9',
  sidebarRight: 'M2.5 3.5h11v9h-11z M10 3.5v9',
  settings:
    'M8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z M8 1.5v1.6 M8 12.9v1.6 M1.5 8h1.6 M12.9 8h1.6 M3.4 3.4l1.1 1.1 M11.5 11.5l1.1 1.1 M3.4 12.6l1.1-1.1 M11.5 4.5l1.1-1.1',
  upload: 'M8 10.5V2.5 M5 5.5l3-3 3 3 M2.5 10.5v3h11v-3',
  search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z M10.3 10.3l3.2 3.2',
  plus: 'M8 3v10 M3 8h10',
  trash: 'M3 4.5h10 M6.5 4.5V3h3v1.5 M4.5 4.5l.6 9h5.8l.6-9',
  edit: 'M10.5 2.8l2.7 2.7-7.7 7.7H2.8v-2.7z',
  x: 'M4 4l8 8 M12 4l-8 8',
  check: 'M3 8.5l3 3 7-7',
  alert: 'M8 2l6.5 11.5h-13z M8 6.5v3.2 M8 11.6v.4',
  info: 'M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8z M8 7.2v4 M8 4.8v.4',
  error: 'M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8z M5.8 5.8l4.4 4.4 M10.2 5.8l-4.4 4.4',
  success: 'M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8z M5.2 8.2l2 2 3.6-4',
  file: 'M4 1.8h5l3 3v9.4H4z M9 1.8v3h3',
  folder: 'M1.8 4h4.4l1.4 1.6h6.6v7.6H1.8z',
  chevronDown: 'M4 6l4 4 4-4',
  chevronRight: 'M6 4l4 4-4 4',
  play: 'M5 3.2v9.6l7.6-4.8z',
  copy: 'M5.5 5.5h7v8h-7z M3.5 10.5v-8h7',
  refresh: 'M13 8a5 5 0 1 1-1.5-3.6 M13 2.5v3h-3',
  radar: 'M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8z M8 4.8a3.2 3.2 0 1 0 0 6.4 M8 8l4.4-4.4',
  api: 'M4.5 5L1.8 8l2.7 3 M11.5 5l2.7 3-2.7 3 M9.4 3.5L6.6 12.5',
  split: 'M2.5 3.5h11v9h-11z M8 3.5v9',
  list: 'M5.5 4h8 M5.5 8h8 M5.5 12h8 M2.5 4h.5 M2.5 8h.5 M2.5 12h.5',
  activity: 'M1.5 8h3l2-5 3 10 2-5h3',
  key: 'M10 1.8a4.2 4.2 0 0 0-3.9 5.7L1.8 11.8v2.4h2.4v-1.6h1.6V11h1.6l.6-.6A4.2 4.2 0 1 0 10 1.8z M11 4.2v.4',
  globe: 'M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8z M1.8 8h12.4 M8 1.8c1.8 1.7 2.6 3.8 2.6 6.2S9.8 12.5 8 14.2C6.2 12.5 5.4 10.4 5.4 8S6.2 3.5 8 1.8z',
  shield: 'M8 1.8l5 2v4c0 3-2.2 5.3-5 6.4-2.8-1.1-5-3.4-5-6.4v-4z',
  sliders: 'M2.5 4.5h6 M11.5 4.5h2 M2.5 11.5h2 M7.5 11.5h6 M10 3v3 M6 10v3',
  dot: 'M8 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
};

export default function Icon({ name, size = 16, title, className, strokeWidth = 1.5 }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={d} />
    </svg>
  );
}
