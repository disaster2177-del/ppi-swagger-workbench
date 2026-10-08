import { IconButton, Tabs } from '../ui/index.jsx';

/** A collapsible app sidebar with its own tab bar. Closed sidebars are not rendered, so the main area expands. */
export default function Sidebar({ id, side, open, title, tabs, tab, onTab, onClose, overlay, children }) {
  if (!open) return null;
  return (
    <>
      {overlay && <div className="sidebar-scrim" onClick={onClose} aria-hidden />}
      <aside id={id} className={`sidebar ${side}${overlay ? ' overlay' : ''}`} aria-label={title}>
        <div className="sidebar-head">
          {tabs.length > 1 ? <Tabs items={tabs} value={tab} onChange={onTab} label={title} className="sidebar-tabs" /> : <span className="eyebrow">{tabs[0]?.label}</span>}
          <IconButton icon="x" size="sm" label={`Close ${side} sidebar`} onClick={onClose} />
        </div>
        <div className="sidebar-body">{children}</div>
      </aside>
    </>
  );
}
