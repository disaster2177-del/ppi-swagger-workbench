/**
 * Credentials used when the BROWSER sends API requests itself. They stay in
 * this browser tab (sessionStorage) and are forgotten when it closes; they
 * are never sent to the server. (When requests go through the server, the
 * server keeps its own encrypted copy instead.)
 */
import { SECRET_FIELDS } from '@workbench/shared/settings';

const KEY = 'ppiwb.secrets';

function load() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

export function createLocalSecrets() {
  let secrets = load();
  return {
    get: () => ({ ...secrets }),
    /** updates: { field: string } sets, { field: null | '' } clears, missing keeps. */
    apply(updates = {}) {
      const next = { ...secrets };
      for (const f of SECRET_FIELDS) {
        if (!(f in updates)) continue;
        if (typeof updates[f] === 'string' && updates[f] !== '') next[f] = updates[f];
        else delete next[f];
      }
      secrets = next;
      try {
        sessionStorage.setItem(KEY, JSON.stringify(secrets));
      } catch {
        /* storage blocked: keep for this page only */
      }
    },
    /** Set the "saved" flags in public settings from this browser's credentials. */
    flags(settings) {
      return {
        ...settings,
        auth: { ...settings.auth, tokenSet: !!secrets.token, passwordSet: !!secrets.password, apiKeyValueSet: !!secrets.apiKeyValue },
      };
    },
  };
}
