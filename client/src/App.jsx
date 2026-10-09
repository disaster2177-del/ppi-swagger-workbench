/**
 * The unified application shell.
 *
 *   [◧] PPI & Swagger   [PPI Only] [Side by Side] [Swagger Only] | [Settings]   [DB] [◨]
 *   ┌ left sidebar ┐┌──────────── main ────────────┐┌ right sidebar ┐
 *   │ Scope        ││  PPI scope   │  YAML / APIs   ││ Objects …     │
 *   │ Projects     ││              │  API form      ││ Activity      │
 *
 * Both sidebars toggle independently; a closed sidebar is removed and the
 * main area takes its space. Below 1100px they open over the content.
 */
import { useCallback, useEffect, useState } from 'react';
import { ToastProvider, useToast } from './ui/index.jsx';
import { AppStateProvider, useAppState } from './state/AppState.jsx';
import { usePref } from './state/prefs.js';
import TopNav, { VIEW_MODES } from './shell/TopNav.jsx';
import Sidebar from './shell/Sidebar.jsx';
import SplitView from './shell/SplitView.jsx';
import usePpiController from './features/ppi/usePpiController.js';
import PpiPane from './features/ppi/PpiPane.jsx';
import ScopeControls from './features/ppi/components/ScopeControls.jsx';
import ObjectList from './features/ppi/components/ObjectList.jsx';
import DetailsPanel from './features/ppi/components/DetailsPanel.jsx';
import ErrorLog from './features/ppi/components/ErrorLog.jsx';
import useWorkbench from './features/workbench/useWorkbench.js';
import WorkbenchPane from './features/workbench/WorkbenchPane.jsx';
import { ActivityPanel, ProjectsPanel } from './features/workbench/SidebarPanels.jsx';
import SettingsPage from './features/settings/SettingsPage.jsx';

function useMediaQuery(query) {
  const get = () => typeof window !== 'undefined' && window.matchMedia?.(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const on = () => setMatches(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

function Shell() {
  const toast = useToast();
  const { source, settings, settingsStatus } = useAppState();
  const narrow = useMediaQuery('(max-width: 1100px)');

  // Side by Side on first visit, then the last view used in this browser.
  const [savedView, setMode] = usePref('viewMode', 'split');
  const view = VIEW_MODES.some((m) => m.id === savedView) ? savedView : 'split';
  const [page, setPage] = useState('workspace');
  const [wideLeft, setWideLeft] = usePref('leftOpen', true);
  const [wideRight, setWideRight] = usePref('rightOpen', false);
  const [narrowLeft, setNarrowLeft] = useState(false);
  const [narrowRight, setNarrowRight] = useState(false);
  const [ratio, setRatio] = usePref('splitRatio', 50);
  const [leftTab, setLeftTab] = useState('scope');
  const [rightTab, setRightTab] = useState('objects');

  const leftOpen = narrow ? narrowLeft : wideLeft;
  const rightOpen = narrow ? narrowRight : wideRight;
  const toggleLeft = () => (narrow ? (setNarrowLeft((v) => !v), setNarrowRight(false)) : setWideLeft((v) => !v));
  const toggleRight = () => (narrow ? (setNarrowRight((v) => !v), setNarrowLeft(false)) : setWideRight((v) => !v));
  useEffect(() => {
    setNarrowLeft(false);
    setNarrowRight(false);
  }, [narrow]);

  const ppiShown = view !== 'swagger';
  const ppiOnScreen = page === 'workspace' && ppiShown;
  const showDetails = useCallback(() => setRightTab('details'), []);
  const ppi = usePpiController({ active: ppiOnScreen, onShowDetails: showDetails });
  const wb = useWorkbench({ source, settings, settingsReady: settingsStatus === 'ready', toast });

  const leftTabs = [...(ppiShown ? [{ id: 'scope', label: 'Scope', icon: 'radar' }] : []), { id: 'projects', label: 'Projects', icon: 'folder' }];
  const rightTabs = [
    ...(ppiShown
      ? [
          { id: 'objects', label: 'Objects', count: ppi.visibleCount },
          { id: 'details', label: 'Details' },
          { id: 'rejected', label: 'Rejected', count: ppi.rejectedCount },
        ]
      : []),
    { id: 'activity', label: 'Activity', icon: 'activity' },
  ];
  const lt = leftTabs.some((t) => t.id === leftTab) ? leftTab : leftTabs[0].id;
  const rt = rightTabs.some((t) => t.id === rightTab) ? rightTab : rightTabs[0].id;

  // Switching to Swagger Only brings the API-related sidebar tabs forward.
  const chooseMode = (m) => {
    setMode(m);
    setPage('workspace');
    if (m === 'swagger') {
      setLeftTab('projects');
      setRightTab('activity');
    } else if (view === 'swagger') {
      setLeftTab('scope');
      setRightTab('objects');
    }
  };

  const openSettings = () => {
    setPage('settings');
    if (narrow) {
      setNarrowLeft(false);
      setNarrowRight(false);
    }
  };

  const wbPane = (
    <WorkbenchPane
      wb={wb}
      settings={settings}
      onOpenSettings={openSettings}
      variant={view === 'swagger' ? 'swagger' : 'forms'}
      onOpenSwagger={() => chooseMode('swagger')}
    />
  );

  return (
    <div className={`app view-${view} page-${page}`}>
      <TopNav
        mode={view}
        page={page}
        onMode={chooseMode}
        onSettings={openSettings}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onToggleLeft={toggleLeft}
        onToggleRight={toggleRight}
        source={source}
      />
      <div className="app-body">
        <Sidebar
          id="sidebar-left"
          side="left"
          title="Left sidebar"
          open={leftOpen}
          overlay={narrow}
          tabs={leftTabs}
          tab={lt}
          onTab={setLeftTab}
          onClose={toggleLeft}
        >
          {lt === 'scope' ? (
            <div className="ppi-panel">
              <ScopeControls {...ppi.controlsProps} />
            </div>
          ) : (
            <ProjectsPanel wb={wb} canCreate={view === 'swagger'} />
          )}
        </Sidebar>

        <main className="app-main" id="main">
          {page === 'settings' && (
            <SettingsPage
              wb={wb}
              exampleEndpointPath={wb.operation?.path ?? wb.detail?.endpoints?.[0]?.path}
              exampleServers={wb.detail?.model?.servers}
              onDone={() => setPage('workspace')}
            />
          )}
          <div className="workspace" hidden={page === 'settings'}>
            <SplitView
              ratio={ratio}
              onRatio={setRatio}
              single={view === 'ppi' ? 'left' : view === 'swagger' ? 'right' : null}
              left={ppiOnScreen ? <PpiPane ppi={ppi} /> : null}
              right={wbPane}
            />
          </div>
        </main>

        <Sidebar
          id="sidebar-right"
          side="right"
          title="Right sidebar"
          open={rightOpen}
          overlay={narrow}
          tabs={rightTabs}
          tab={rt}
          onTab={setRightTab}
          onClose={toggleRight}
        >
          {rt === 'objects' && (
            <div className="ppi-panel fill">
              <ObjectList {...ppi.listProps} />
            </div>
          )}
          {rt === 'details' && (
            <div className="ppi-panel">
              <DetailsPanel {...ppi.detailsProps} />
            </div>
          )}
          {rt === 'rejected' && (
            <div className="ppi-panel">
              <ErrorLog />
            </div>
          )}
          {rt === 'activity' && <ActivityPanel wb={wb} />}
        </Sidebar>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </AppStateProvider>
  );
}
