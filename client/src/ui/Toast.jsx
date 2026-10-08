import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';

const ToastContext = createContext(null);
const ICONS = { success: 'success', error: 'error', warning: 'alert', info: 'info' };
const DURATION = { success: 4500, info: 5000, warning: 7000, error: 9000 };

/**
 * App-wide notifications.
 *   const toast = useToast();
 *   toast.success('YAML uploaded successfully.', { message: '4 files stored' });
 *   toast.error('API request failed.', { message: hint, details: technicalText });
 */
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const seq = useRef(0);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (tone, title, { message, details, duration } = {}) => {
      seq.current += 1;
      const id = seq.current;
      setItems((list) => [...list.slice(-4), { id, tone, title, message, details }]);
      const ms = duration ?? DURATION[tone];
      if (ms) timers.current.set(id, setTimeout(() => dismiss(id), ms));
      return id;
    },
    [dismiss],
  );

  const api = useMemo(
    () => ({
      success: (t, o) => push('success', t, o),
      error: (t, o) => push('error', t, o),
      warning: (t, o) => push('warning', t, o),
      info: (t, o) => push('info', t, o),
      dismiss,
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite" aria-relevant="additions">
        {items.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.tone}`}
            role={t.tone === 'error' ? 'alert' : 'status'}
            onMouseEnter={() => clearTimeout(timers.current.get(t.id))}
          >
            <span className="toast-icon">
              <Icon name={ICONS[t.tone]} />
            </span>
            <div>
              <div className="toast-title">{t.title}</div>
              {t.message && <div className="toast-msg">{t.message}</div>}
              {t.details && (
                <details>
                  <summary>Technical details</summary>
                  <pre>{typeof t.details === 'string' ? t.details : JSON.stringify(t.details, null, 2)}</pre>
                </details>
              )}
            </div>
            <button type="button" className="icon-btn sm" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
