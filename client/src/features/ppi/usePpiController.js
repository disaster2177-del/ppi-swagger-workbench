/**
 * All PPI state in one hook (moved out of the old standalone App.jsx), so the
 * unified shell can place the scope, its controls (left sidebar) and its
 * object list / details / rejected log (right sidebar) independently.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RANGE_STEPS } from './components/ScopeControls.jsx';
import useTacticalPicture from './hooks/useTacticalPicture.js';
import useNow from './hooks/useNow.js';

const DEFAULT_SETTINGS = {
  rangeNm: 24,
  orientation: 'NORTH_UP',
  showSweep: true,
  showLabels: true,
  showTrails: true,
  showLeaders: true,
  leaderMinutes: 6,
  engine: 'classic', // 'classic' (RadarScope) | 'turf' (TurfRadarScope)
};

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('scopeSettings') ?? '{}') };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const ORIGIN = { x: 0, y: 0 };

const isTyping = (el) =>
  !!el && (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable || !!el.closest?.('[role="dialog"]'));

/** `active`: the scope is on screen (keyboard shortcuts only work then). */
export default function usePpiController({ active, onShowDetails }) {
  const { objects, connection, status, removeObject } = useTacticalPicture();
  const now = useNow(1000);
  const [settings, setSettings] = useState(loadSettings);
  const [filters, setFilters] = useState({ hiddenKinds: new Set(), hiddenIdentities: new Set(), hiddenSources: new Set() });
  const [offset, setOffset] = useState(ORIGIN);
  const [selectedId, setSelectedId] = useState(null);
  const fallbackRef = useRef(null);
  const showDetails = useRef(onShowDetails);
  showDetails.current = onShowDetails;

  useEffect(() => {
    try {
      localStorage.setItem('scopeSettings', JSON.stringify(settings));
    } catch {
      /* storage unavailable */
    }
  }, [settings]);

  const all = useMemo(() => Object.values(objects), [objects]);

  // Most recently updated OWNSHIP object is the scope centre.
  const ownship = useMemo(() => all.filter((o) => o.kind === 'OWNSHIP').sort((a, b) => b.timestamp - a.timestamp)[0] ?? null, [all]);

  // Without own ship data, anchor the picture on the first absolute position we see.
  const reference = useMemo(() => {
    if (ownship) return ownship.geometry.position;
    if (!fallbackRef.current) {
      for (const o of all) {
        const g = o.geometry;
        const p = g.position ?? g.center ?? g.origin ?? g.points?.[0];
        if (p && p.lat !== undefined) {
          fallbackRef.current = p;
          break;
        }
      }
    }
    return fallbackRef.current;
  }, [ownship, all]);

  const counts = useMemo(() => {
    const kind = {};
    const identity = {};
    const sources = {};
    for (const o of all) {
      kind[o.kind] = (kind[o.kind] ?? 0) + 1;
      identity[o.identity] = (identity[o.identity] ?? 0) + 1;
      sources[o.source] = (sources[o.source] ?? 0) + 1;
    }
    return { kind, identity, sources: Object.entries(sources).sort() };
  }, [all]);

  const visible = useMemo(
    () =>
      all.filter(
        (o) =>
          o.kind !== 'OWNSHIP' &&
          !filters.hiddenKinds.has(o.kind) &&
          !filters.hiddenIdentities.has(o.identity) &&
          !filters.hiddenSources.has(o.source),
      ),
    [all, filters],
  );

  const selected = selectedId ? objects[selectedId] ?? null : null;

  const select = useCallback((id) => {
    setSelectedId(id);
    if (id) showDetails.current?.();
  }, []);

  const stepRange = useCallback(
    (dir) =>
      setSettings((s) => {
        const i = RANGE_STEPS.indexOf(s.rangeNm);
        const next = RANGE_STEPS[Math.min(RANGE_STEPS.length - 1, Math.max(0, (i < 0 ? 5 : i) + dir))];
        return next === s.rangeNm ? s : { ...s, rangeNm: next };
      }),
    [],
  );

  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'c' || e.key === 'C') setOffset(ORIGIN);
      else if (e.key === 'h' || e.key === 'H') setSettings((s) => ({ ...s, orientation: s.orientation === 'HEAD_UP' ? 'NORTH_UP' : 'HEAD_UP' }));
      else if (e.key === 't' || e.key === 'T') setSettings((s) => ({ ...s, engine: s.engine === 'turf' ? 'classic' : 'turf' }));
      else if (e.key === '+' || e.key === '=') stepRange(-1);
      else if (e.key === '-') stepRange(1);
      else if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, stepRange]);

  return {
    connection,
    status,
    objectCount: all.length,
    now,
    scopeProps: {
      objects: visible,
      ownship,
      showOwnship: !filters.hiddenKinds.has('OWNSHIP'),
      reference,
      settings,
      offset,
      onOffsetChange: setOffset,
      onRangeStep: stepRange,
      selectedId,
      onSelect: select,
      now,
    },
    controlsProps: { settings, setSettings, filters, setFilters, counts, onRecenter: () => setOffset(ORIGIN) },
    listProps: { objects: visible, reference, selectedId, onSelect: select, now },
    detailsProps: {
      obj: selected,
      reference,
      now,
      onCenter: (local) => setOffset(local),
      onRemove: (id) => {
        removeObject(id);
        setSelectedId(null);
      },
    },
    visibleCount: visible.length,
    rejectedCount: status?.stats?.rejected ?? 0,
  };
}
