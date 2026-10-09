/**
 * App-wide state: the data source (server or browser workspace) and the
 * shared settings loaded from it.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { withDefaults } from '@workbench/shared/settings';
import { resolveDataSource } from '../services/dataSource.js';
import { toUserError } from '../services/errors.js';

const AppStateContext = createContext(null);

export function AppStateProvider({ children }) {
  const [source, setSource] = useState(null);
  const [settings, setSettings] = useState(() => withDefaults({}));
  const [settingsStatus, setSettingsStatus] = useState('loading'); // loading | ready | error
  const [settingsError, setSettingsError] = useState(null);

  useEffect(() => {
    let alive = true;
    resolveDataSource().then((s) => alive && setSource(s));
    return () => {
      alive = false;
    };
  }, []);

  const reloadSettings = useCallback(async () => {
    if (!source) return;
    try {
      const s = await source.settings.get();
      setSettings(s);
      setSettingsStatus('ready');
      setSettingsError(null);
    } catch (err) {
      setSettings(withDefaults({}));
      setSettingsStatus('error');
      setSettingsError(toUserError(err));
    }
  }, [source]);

  useEffect(() => {
    reloadSettings();
  }, [reloadSettings]);

  const saveSettings = useCallback(
    async (next, secrets) => {
      const saved = await source.settings.save(next, secrets);
      setSettings(saved);
      return saved;
    },
    [source],
  );

  const value = useMemo(
    () => ({ source, settings, settingsStatus, settingsError, saveSettings, reloadSettings }),
    [source, settings, settingsStatus, settingsError, saveSettings, reloadSettings],
  );
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used inside <AppStateProvider>');
  return ctx;
}
