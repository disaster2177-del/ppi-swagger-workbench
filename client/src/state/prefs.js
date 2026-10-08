import { useCallback, useState } from 'react';

/** Per-browser UI conveniences (sidebar open, split width). Storage may be unavailable; never required. */
export function readPref(key, fallback) {
  try {
    const v = localStorage.getItem(`workbench.${key}`);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function writePref(key, value) {
  try {
    localStorage.setItem(`workbench.${key}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function usePref(key, fallback) {
  const [value, setValue] = useState(() => readPref(key, fallback));
  const set = useCallback(
    (next) =>
      setValue((prev) => {
        const v = typeof next === 'function' ? next(prev) : next;
        writePref(key, v);
        return v;
      }),
    [key],
  );
  return [value, set];
}
