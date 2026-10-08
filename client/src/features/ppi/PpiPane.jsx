import { lazy, Suspense } from 'react';
import RadarScope from './components/RadarScope.jsx';
import StatusBar from './components/StatusBar.jsx';

// Loaded on first use so the classic scope doesn't pay for Turf.js.
const TurfRadarScope = lazy(() => import('./components/TurfRadarScope.jsx'));

/** The radar display with its live status strip. Both scope engines take the same props. */
export default function PpiPane({ ppi }) {
  const { scopeProps } = ppi;
  return (
    <section className="ppi-pane" aria-label="PPI radar display">
      <StatusBar connection={ppi.connection} status={ppi.status} objectCount={ppi.objectCount} now={ppi.now} />
      <div className="ppi-scope-wrap">
        {scopeProps.settings.engine === 'turf' ? (
          <Suspense fallback={<div className="scope-loading">Loading Turf.js engine…</div>}>
            <TurfRadarScope {...scopeProps} />
          </Suspense>
        ) : (
          <RadarScope {...scopeProps} />
        )}
      </div>
    </section>
  );
}
