import { Badge, Icon, IconButton } from '../ui/index.jsx';

export const VIEW_MODES = [
  { id: 'ppi', label: 'PPI Only', icon: 'radar' },
  { id: 'split', label: 'Side by Side', icon: 'split' },
  { id: 'swagger', label: 'Swagger Only', icon: 'api' },
];

export default function TopNav({ mode, page, onMode, onSettings, leftOpen, rightOpen, onToggleLeft, onToggleRight, source }) {
  return (
    <header className="topnav">
      <IconButton
        icon="sidebarLeft"
        label={leftOpen ? 'Hide left sidebar' : 'Show left sidebar'}
        pressed={leftOpen}
        onClick={onToggleLeft}
        aria-controls="sidebar-left"
        aria-expanded={leftOpen}
      />
      <div className="brand" aria-label="PPI and Swagger Workbench">
        <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="16" cy="16" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
          <path d="M16 16 L25 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="brand-text">
          PPI <span className="brand-amp">&amp;</span> Swagger
        </span>
      </div>

      <nav className="viewnav" aria-label="View mode">
        {VIEW_MODES.map((m) => {
          const active = page === 'workspace' && mode === m.id;
          return (
            <button key={m.id} type="button" className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} aria-label={m.label} title={m.label} onClick={() => onMode(m.id)}>
              <Icon name={m.icon} size={15} />
              <span className="viewnav-label">{m.label}</span>
            </button>
          );
        })}
        <span className="viewnav-sep" aria-hidden />
        <button type="button" className={page === 'settings' ? 'active' : ''} aria-current={page === 'settings' ? 'page' : undefined} aria-label="Settings" title="Settings" onClick={onSettings}>
          <Icon name="settings" size={15} />
          <span className="viewnav-label">Settings</span>
        </button>
      </nav>

      <div className="topnav-end">
        {source && (
          <span className="storage-indicator" title={source.note ?? source.label}>
            <Badge tone={source.kind === 'memory' ? 'warn' : 'good'}>
              <Icon name="dot" size={10} />
              {source.kind === 'server' ? 'MongoDB' : source.kind === 'artifact' ? 'Workspace DB' : 'Not saved'}
            </Badge>
          </span>
        )}
        <IconButton
          icon="sidebarRight"
          label={rightOpen ? 'Hide right sidebar' : 'Show right sidebar'}
          pressed={rightOpen}
          onClick={onToggleRight}
          aria-controls="sidebar-right"
          aria-expanded={rightOpen}
        />
      </div>
    </header>
  );
}
