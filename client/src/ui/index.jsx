/**
 * Shared UI kit. Every screen (PPI, workbench, settings) builds from these,
 * so buttons, inputs, badges and dialogs look and behave the same everywhere.
 */
import { forwardRef, useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

export { default as Icon } from './Icon.jsx';
export { ToastProvider, useToast } from './Toast.jsx';
export { default as Modal, ConfirmDialog } from './Modal.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

export function Button({ variant = 'secondary', size, icon, loading, children, className, type = 'button', ...rest }) {
  return (
    <button
      type={type}
      className={cx('btn', variant !== 'secondary' && `btn-${variant}`, size === 'sm' && 'btn-sm', className)}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden /> : icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, size, pressed, className, ...rest }) {
  return (
    <button
      type="button"
      className={cx('icon-btn', size === 'sm' && 'sm', className)}
      aria-label={label}
      title={label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 14 : 16} />
    </button>
  );
}

/** Label + control + help + error, consistently laid out. */
export function Field({ id, label, required, optional, help, error, keyName, className, children, labelAction }) {
  return (
    <div className={cx('field', error && 'invalid', className)}>
      {label !== undefined && (
        <label className="field-label" htmlFor={id}>
          {label}
          {required && (
            <span className="field-req" aria-label="required">
              *
            </span>
          )}
          {optional && <span className="field-tag">Optional</span>}
          {keyName && <span className="field-key">{keyName}</span>}
          {labelAction}
        </label>
      )}
      {children}
      {help && <div className="field-help">{help}</div>}
      {error && (
        <div className="field-error" role="alert" id={id ? `${id}-error` : undefined}>
          {error}
        </div>
      )}
    </div>
  );
}

export const TextInput = forwardRef(function TextInput({ className, size, ...rest }, ref) {
  return <input ref={ref} className={cx('input', size === 'sm' && 'sm', className)} {...rest} />;
});

export const Select = forwardRef(function Select({ className, size, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx('select', size === 'sm' && 'sm', className)} {...rest}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef(function Textarea({ className, code, ...rest }, ref) {
  return <textarea ref={ref} className={cx('textarea', code && 'code', className)} {...rest} />;
});

export function SearchInput({ value, onChange, placeholder = 'Search…', label, id, ...rest }) {
  return (
    <div className="search-input">
      <Icon name="search" size={14} />
      <input
        id={id}
        type="search"
        className="input sm"
        value={value}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
    </div>
  );
}

/** Toggle. `value` may be undefined ("not set") when `allowUnset`. */
export function Switch({ id, checked, onChange, label, unsetLabel, disabled }) {
  const unset = checked === undefined;
  return (
    <label className={cx('switch', unset && 'unset')}>
      <input id={id} type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden />
      <span>{unset && unsetLabel ? unsetLabel : label ?? (checked ? 'Yes' : 'No')}</span>
    </label>
  );
}

/** Free-text list: type and press Enter (or comma) to add an item. */
export function ChipsInput({ id, values, onChange, placeholder, numeric, ariaDescribedBy }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    const next = numeric ? Number(v) : v;
    if (numeric && !Number.isFinite(next)) return;
    onChange([...values, next]);
    setDraft('');
  };
  return (
    <div className="chips" onClick={(e) => e.currentTarget.querySelector('input')?.focus()}>
      {values.map((v, i) => (
        <span className="chip" key={`${v}-${i}`}>
          {String(v)}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((_, j) => j !== i))}>
            ×
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        inputMode={numeric ? 'decimal' : undefined}
        placeholder={values.length ? '' : placeholder}
        aria-describedby={ariaDescribedBy}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          } else if (e.key === 'Backspace' && !draft && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

export function MethodBadge({ method }) {
  const m = String(method).toLowerCase();
  return <span className={cx('method', m)}>{String(method).toUpperCase()}</span>;
}

export function StatusCode({ status }) {
  return <span className={cx('status-code', `s${Math.floor((status ?? 0) / 100)}`)}>{status || 'ERR'}</span>;
}

export function Badge({ tone, children, title }) {
  return (
    <span className={cx('badge', tone)} title={title}>
      {children}
    </span>
  );
}

export function EmptyState({ icon = 'info', title, children, action }) {
  return (
    <div className="empty-state">
      <Icon name={icon} size={28} strokeWidth={1.2} />
      {title && <strong>{title}</strong>}
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/** Segmented tab bar. items: [{ id, label, icon?, count? }] */
export function Tabs({ items, value, onChange, label, className }) {
  return (
    <div className={cx('seg', className)} role="tablist" aria-label={label}>
      {items.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}>
          {t.icon && <Icon name={t.icon} size={13} />} {t.label}
          {t.count !== undefined && <span className="tab-count tabular">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Copy text; falls back to selecting the text when the clipboard is refused. */
export function CopyButton({ text, label = 'Copy', targetRef }) {
  const [state, setState] = useState('idle');
  const timer = useRef();
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('done');
    } catch {
      const el = targetRef?.current;
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      setState('selected');
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1800);
  };
  return (
    <Button size="sm" variant="ghost" icon={state === 'done' ? 'check' : 'copy'} onClick={copy}>
      {state === 'done' ? 'Copied' : state === 'selected' ? 'Selected — press Ctrl+C' : label}
    </Button>
  );
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.round((now - t) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return formatDateTime(iso);
}
