/**
 * Renders one value of any JSON schema as form controls, recursively.
 *
 * Everything comes from the schema in the YAML file:
 *   enum                → dropdown (values and order exactly as in the YAML)
 *   boolean             → switch
 *   integer / number    → number input with min / max / step
 *   string              → text / email / url / date / password / textarea / file, by format and length
 *   array of enums      → multi-select dropdown with chips
 *   array of primitives → chips input
 *   array of objects    → repeatable groups
 *   object              → nested group (optional groups start collapsed)
 *   oneOf / anyOf       → "type" dropdown, then the chosen variant
 *   anything else       → JSON editor
 * Defaults, examples, descriptions and constraints are shown as help text.
 */
import { useEffect, useMemo, useState } from 'react';
import { enumLabel, humanize, initialValue, isObject, resolveSchema, variantLabel, widgetFor } from '@workbench/shared/openapi';
import { Button, ChipsInput, Field, Select, Switch, Textarea, TextInput } from '../../ui/index.jsx';

const MAX_DEPTH = 8;

export const fieldId = (path) => `fld-${String(path).replace(/[^\w-]/g, '_')}`;

function hintFor(s) {
  const parts = [];
  if (s.type === 'integer' || s.type === 'number') {
    const min = typeof s.exclusiveMinimum === 'number' ? `> ${s.exclusiveMinimum}` : s.minimum !== undefined ? `${s.exclusiveMinimum ? '>' : '≥'} ${s.minimum}` : null;
    const max = typeof s.exclusiveMaximum === 'number' ? `< ${s.exclusiveMaximum}` : s.maximum !== undefined ? `${s.exclusiveMaximum ? '<' : '≤'} ${s.maximum}` : null;
    if (min && max) parts.push(`${min} and ${max}`);
    else if (min || max) parts.push(min ?? max);
    if (s.multipleOf) parts.push(`multiple of ${s.multipleOf}`);
  }
  if (s.type === 'string') {
    if (s.minLength !== undefined && s.maxLength !== undefined) parts.push(`${s.minLength}–${s.maxLength} characters`);
    else if (s.maxLength !== undefined) parts.push(`up to ${s.maxLength} characters`);
    else if (s.minLength !== undefined) parts.push(`at least ${s.minLength} characters`);
    if (s.format && !['binary', 'password'].includes(s.format)) parts.push(`format: ${s.format}`);
  }
  if (s.type === 'array') {
    if (s.minItems !== undefined) parts.push(`at least ${s.minItems}`);
    if (s.maxItems !== undefined) parts.push(`at most ${s.maxItems}`);
    if (s.uniqueItems) parts.push('no duplicates');
  }
  if (s.default !== undefined && typeof s.default !== 'object') parts.push(`default: ${enumLabel(s.default)}`);
  if (s.example !== undefined && typeof s.example !== 'object' && s.type !== 'boolean') parts.push(`e.g. ${s.example}`);
  return parts.join(' · ');
}

function Help({ description, hint }) {
  if (!description && !hint) return null;
  return (
    <>
      {description}
      {description && hint ? <br /> : null}
      {hint && <span className="field-hint">{hint}</span>}
    </>
  );
}

const STRING_INPUT = { email: 'email', uri: 'url', url: 'url', date: 'date', password: 'password', time: 'time' };

export default function SchemaField(props) {
  const { schema, root, name, label: labelProp, value, onChange, path, required, errors, depth = 0, ancestors = [], description, example, deprecated, bare } = props;
  const resolved = useMemo(() => resolveSchema(schema, root, ancestors), [schema, root, ancestors]);
  const s = resolved.schema;
  const open = useMemo(() => [...ancestors, ...resolved.refs], [ancestors, resolved.refs]);
  if (s.readOnly) return null;

  const id = fieldId(path);
  const label = labelProp ?? s.title ?? humanize(name);
  const error = errors?.[path];
  const hint = hintFor(example !== undefined && s.example === undefined ? { ...s, example } : s);
  const help = <Help description={s.description ?? description} hint={hint} />;
  const common = {
    id,
    label: bare ? undefined : label,
    required,
    optional: !required,
    error,
    keyName: name && humanize(name) !== name ? name : undefined,
    help: s.description || description || hint ? help : null,
    labelAction: deprecated || s.deprecated ? <span className="badge warn">Deprecated</span> : null,
  };

  if (resolved.error) {
    return (
      <Field {...common} help={`This part of the definition can't be shown as a form (${resolved.error}). Enter JSON instead.`}>
        <JsonEditor id={id} value={value} onChange={onChange} />
      </Field>
    );
  }

  const widget = depth > MAX_DEPTH || (resolved.recursive && depth > 0 && s.type === 'object') ? 'json' : widgetFor(s);
  const aria = { 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? `${id}-error` : undefined, 'aria-required': required || undefined };

  switch (widget) {
    case 'enum': {
      const index = s.enum.findIndex((v) => v === value || (value !== undefined && String(v) === String(value)));
      return (
        <Field {...common}>
          <Select id={id} value={index < 0 ? '' : String(index)} onChange={(e) => onChange(e.target.value === '' ? undefined : s.enum[Number(e.target.value)])} {...aria}>
            <option value="">{required ? 'Select…' : '— Not set —'}</option>
            {s.enum.map((v, i) => (
              <option key={i} value={i} title={String(v)}>
                {enumLabel(v)}
              </option>
            ))}
          </Select>
        </Field>
      );
    }

    case 'boolean':
      return (
        <Field {...common}>
          <div className="bool-row">
            <Switch id={id} checked={value === undefined ? undefined : value === true || value === 'true'} onChange={onChange} unsetLabel="Not set" />
            {!required && value !== undefined && (
              <button type="button" className="btn-link" onClick={() => onChange(undefined)}>
                Clear
              </button>
            )}
          </div>
        </Field>
      );

    case 'number':
      return (
        <Field {...common}>
          <TextInput
            id={id}
            type="number"
            inputMode={s.type === 'integer' ? 'numeric' : 'decimal'}
            step={s.type === 'integer' ? 1 : s.multipleOf ?? 'any'}
            min={typeof s.minimum === 'number' ? s.minimum : undefined}
            max={typeof s.maximum === 'number' ? s.maximum : undefined}
            placeholder={s.example !== undefined ? String(s.example) : example !== undefined ? String(example) : undefined}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
            {...aria}
          />
        </Field>
      );

    case 'file':
      return (
        <Field {...common} help={value?.name ? `${value.name} · ${Math.ceil(value.size / 1024)} KB` : common.help}>
          <input id={id} type="file" className="input" onChange={(e) => onChange(e.target.files?.[0] ?? undefined)} {...aria} />
        </Field>
      );

    case 'string': {
      const long = (s.maxLength ?? 0) > 256 || s.format === 'textarea' || s.format === 'markdown';
      const placeholder = s.example !== undefined ? String(s.example) : example !== undefined ? String(example) : s.format === 'date-time' ? '2026-01-31T12:00:00Z' : undefined;
      return (
        <Field {...common}>
          {long ? (
            <Textarea id={id} rows={3} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} {...aria} />
          ) : (
            <TextInput
              id={id}
              type={STRING_INPUT[s.format] ?? 'text'}
              value={value ?? ''}
              placeholder={placeholder}
              maxLength={s.maxLength}
              autoComplete={s.format === 'password' ? 'new-password' : 'off'}
              spellCheck={false}
              onChange={(e) => onChange(e.target.value)}
              {...aria}
            />
          )}
        </Field>
      );
    }

    case 'array':
      return <ArrayField {...props} s={s} open={open} common={common} aria={aria} />;

    case 'object':
      return <ObjectField {...props} s={s} open={open} common={common} label={label} />;

    case 'variant':
      return <VariantField {...props} s={s} open={open} common={common} label={label} />;

    default:
      return (
        <Field {...common} help={common.help ?? 'Enter JSON.'}>
          <JsonEditor id={id} value={value} onChange={onChange} />
        </Field>
      );
  }
}

// --------------------------------------------------------------------------- arrays

function ArrayField({ s, open, root, value, onChange, path, errors, depth, common, aria }) {
  const list = Array.isArray(value) ? value : [];
  const item = resolveSchema(s.items ?? {}, root, open);
  const itemWidget = widgetFor(item.schema);

  if (itemWidget === 'enum') {
    const remaining = item.schema.enum.map((v, i) => [v, i]).filter(([v]) => !list.includes(v));
    return (
      <Field {...common}>
        <Select id={common.id} value="" disabled={!remaining.length} onChange={(e) => e.target.value !== '' && onChange([...list, item.schema.enum[Number(e.target.value)]])} {...aria}>
          <option value="">{remaining.length ? (list.length ? 'Add another…' : 'Choose…') : 'All selected'}</option>
          {remaining.map(([v, i]) => (
            <option key={i} value={i} title={String(v)}>
              {enumLabel(v)}
            </option>
          ))}
        </Select>
        {list.length > 0 && (
          <div className="chip-list">
            {list.map((v) => (
              <span className="chip" key={String(v)}>
                {enumLabel(v)}
                <button type="button" aria-label={`Remove ${enumLabel(v)}`} onClick={() => onChange(list.filter((x) => x !== v))}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </Field>
    );
  }

  if (['string', 'number'].includes(itemWidget)) {
    return (
      <Field {...common} help={common.help ?? 'Press Enter after each value.'}>
        <ChipsInput
          id={common.id}
          values={list}
          numeric={itemWidget === 'number'}
          onChange={(v) => onChange(v.length ? v : undefined)}
          placeholder={item.schema.example !== undefined ? `e.g. ${item.schema.example} — press Enter to add` : 'Type a value and press Enter'}
        />
      </Field>
    );
  }

  const add = () => {
    const init = initialValue(s.items ?? {}, root, 0, open);
    onChange([...list, init ?? (item.schema.type === 'object' ? {} : undefined)]);
  };
  return (
    <fieldset className={`wb-group level-${Math.min(depth, 3)}${common.error ? ' invalid' : ''}`}>
      <legend className="wb-group-head">
        <span className="field-label">
          {common.label}
          {common.required ? <span className="field-req">*</span> : <span className="field-tag">Optional</span>}
          <span className="field-tag tabular">
            {list.length} item{list.length === 1 ? '' : 's'}
          </span>
        </span>
      </legend>
      {common.help && <div className="field-help">{common.help}</div>}
      {common.error && (
        <div className="field-error" id={`${common.id}-error`} role="alert">
          {common.error}
        </div>
      )}
      <div className="wb-array" id={common.id} tabIndex={-1}>
        {list.map((v, i) => (
          <div className="wb-array-item" key={i}>
            <div className="wb-array-item-head">
              <span className="eyebrow">
                {item.schema.title ?? 'Item'} {i + 1}
              </span>
              <Button size="sm" variant="ghost" icon="trash" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label={`Remove item ${i + 1}`}>
                Remove
              </Button>
            </div>
            <SchemaField
              schema={s.items ?? {}}
              root={root}
              name=""
              label=""
              bare
              value={v}
              onChange={(nv) => onChange(list.map((x, j) => (j === i ? nv : x)))}
              path={`${path}[${i}]`}
              required
              errors={errors}
              depth={depth + 1}
              ancestors={open}
            />
          </div>
        ))}
        <Button size="sm" icon="plus" onClick={add} disabled={s.maxItems !== undefined && list.length >= s.maxItems}>
          Add {item.schema.title ? item.schema.title.toLowerCase() : 'item'}
        </Button>
      </div>
    </fieldset>
  );
}

// --------------------------------------------------------------------------- objects

function hasErrorUnder(errors, path) {
  return Object.keys(errors ?? {}).some((k) => k === path || k.startsWith(`${path}.`) || k.startsWith(`${path}[`));
}

function ObjectField({ s, open, root, value, onChange, path, errors, depth, required, common, label, bare, hiddenKeys = [] }) {
  const obj = isObject(value) ? value : {};
  const req = new Set(Array.isArray(s.required) ? s.required : []);
  const entries = Object.entries(s.properties ?? {}).filter(([k, child]) => !hiddenKeys.includes(k) && !resolveSchema(child, root, open).schema.readOnly);
  const set = (k, v) => {
    const next = { ...obj };
    if (v === undefined) delete next[k];
    else next[k] = v;
    onChange(Object.keys(next).length ? next : undefined);
  };
  const filled = Object.keys(obj).length > 0;

  const grid = (
    <div className="form-grid">
      {entries.map(([k, child]) => (
        <SchemaField
          key={k}
          schema={child}
          root={root}
          name={k}
          value={obj[k]}
          onChange={(v) => set(k, v)}
          path={`${path}.${k}`}
          required={req.has(k)}
          errors={errors}
          depth={depth + 1}
          ancestors={open}
        />
      ))}
    </div>
  );

  if (bare) return grid;

  // Optional nested objects start collapsed so long forms stay scannable.
  if (!required && depth > 0) {
    return (
      <details className={`wb-group level-${Math.min(depth, 3)} collapsible`} open={filled || hasErrorUnder(errors, path) || undefined}>
        <summary className="wb-group-head">
          <span className="field-label">
            {label} <span className="field-tag">Optional</span>
            {common.keyName && <span className="field-key">{common.keyName}</span>}
          </span>
          {filled && (
            <button
              type="button"
              className="btn-link"
              onClick={(e) => {
                e.preventDefault();
                onChange(undefined);
              }}
            >
              Clear
            </button>
          )}
        </summary>
        {s.description && <div className="field-help">{s.description}</div>}
        {grid}
      </details>
    );
  }

  return (
    <fieldset className={`wb-group level-${Math.min(depth, 3)}`}>
      <legend className="wb-group-head">
        <span className="field-label">
          {label}
          {required ? <span className="field-req">*</span> : <span className="field-tag">Optional</span>}
          {common.keyName && <span className="field-key">{common.keyName}</span>}
        </span>
      </legend>
      {s.description && <div className="field-help">{s.description}</div>}
      {common.error && <div className="field-error">{common.error}</div>}
      {grid}
    </fieldset>
  );
}

// --------------------------------------------------------------------------- oneOf / anyOf

/** A property whose schema allows exactly one value tells variants apart (e.g. type: [card]). */
function constProperty(variantSchema) {
  for (const [k, p] of Object.entries(variantSchema.properties ?? {})) {
    if (Array.isArray(p?.enum) && p.enum.length === 1) return [k, p.enum[0]];
    if (p?.const !== undefined) return [k, p.const];
  }
  return null;
}

function guessVariant(variants, value, root, open, discriminator) {
  if (!isObject(value)) return 0;
  const resolved = variants.map((v) => resolveSchema(v, root, open).schema);
  if (discriminator?.propertyName && value[discriminator.propertyName] !== undefined) {
    const target = value[discriminator.propertyName];
    const mapped = discriminator.mapping?.[target];
    const byMap = mapped ? variants.findIndex((v) => v.$ref === mapped) : -1;
    if (byMap >= 0) return byMap;
    const byName = variants.findIndex((v) => v.$ref?.split('/').pop() === target);
    if (byName >= 0) return byName;
  }
  const byConst = resolved.findIndex((r) => {
    const c = constProperty(r);
    return c && value[c[0]] === c[1];
  });
  if (byConst >= 0) return byConst;
  const byKeys = resolved.findIndex((r) => (r.required ?? []).length && r.required.every((k) => k in value));
  return byKeys >= 0 ? byKeys : 0;
}

function VariantField({ s, open, root, value, onChange, path, errors, depth, required, common, label }) {
  const variants = s.oneOf ?? s.anyOf;
  const [index, setIndex] = useState(() => guessVariant(variants, value, root, open, s.discriminator));
  const labels = useMemo(() => variants.map((v, i) => variantLabel(v, root, i)), [variants, root]);
  // A one-value property (e.g. type: [card]) identifies the variant; it is filled in automatically.
  const constPair = constProperty(resolveSchema(variants[index], root, open).schema);
  const constKey = constPair?.[0];
  const childChange = (v) => onChange(constPair && isObject(v) ? { ...v, [constPair[0]]: constPair[1] } : v);

  // Keep the selector in step when the value is replaced from outside (sample data, reset).
  useEffect(() => {
    if (value !== undefined) setIndex(guessVariant(variants, value, root, open, s.discriminator));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value === undefined]);

  const choose = (i) => {
    setIndex(i);
    const chosen = resolveSchema(variants[i], root, open).schema;
    let next = initialValue(variants[i], root, 0, open);
    const c = constProperty(chosen);
    if (c) next = { ...(isObject(next) ? next : {}), [c[0]]: c[1] };
    if (s.discriminator?.propertyName && variants[i].$ref) {
      const mapping = Object.entries(s.discriminator.mapping ?? {}).find(([, ref]) => ref === variants[i].$ref)?.[0];
      next = { ...(isObject(next) ? next : {}), [s.discriminator.propertyName]: mapping ?? variants[i].$ref.split('/').pop() };
    }
    onChange(next);
  };

  return (
    <fieldset className={`wb-group level-${Math.min(depth, 3)}`}>
      <legend className="wb-group-head">
        <span className="field-label">
          {label}
          {required ? <span className="field-req">*</span> : <span className="field-tag">Optional</span>}
          {common.keyName && <span className="field-key">{common.keyName}</span>}
        </span>
      </legend>
      {s.description && <div className="field-help">{s.description}</div>}
      <Field id={`${common.id}-variant`} label="Choose type">
        <Select id={`${common.id}-variant`} value={String(index)} onChange={(e) => choose(Number(e.target.value))}>
          {labels.map((l, i) => (
            <option key={i} value={i}>
              {humanize(l) || l}
            </option>
          ))}
        </Select>
      </Field>
      <SchemaField
        key={index}
        schema={variants[index]}
        root={root}
        name=""
        label={labels[index]}
        bare={resolveSchema(variants[index], root, open).schema.type === 'object'}
        hiddenKeys={constKey ? [constKey] : []}
        value={value}
        onChange={childChange}
        path={path}
        required={required}
        errors={errors}
        depth={depth + 1}
        ancestors={open}
      />
    </fieldset>
  );
}

// --------------------------------------------------------------------------- JSON fallback

export function JsonEditor({ id, value, onChange, rows = 5 }) {
  const toText = (v) => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v, null, 2));
  const [text, setText] = useState(() => toText(value));
  const [bad, setBad] = useState(null);
  useEffect(() => {
    setText((t) => {
      try {
        if (t.trim() && JSON.stringify(JSON.parse(t)) === JSON.stringify(value)) return t;
      } catch {
        /* replace */
      }
      return toText(value);
    });
  }, [value]);
  return (
    <>
      <Textarea
        id={id}
        code
        rows={rows}
        value={text}
        spellCheck={false}
        placeholder="{ }"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (!text.trim()) {
            setBad(null);
            onChange(undefined);
            return;
          }
          try {
            onChange(JSON.parse(text));
            setBad(null);
          } catch (err) {
            setBad(`Not valid JSON: ${err.message}`);
            onChange(text);
          }
        }}
      />
      {bad && <div className="field-error">{bad}</div>}
    </>
  );
}
