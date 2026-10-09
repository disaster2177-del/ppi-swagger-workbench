/**
 * Settings: where requests go (environments with Base URL + Base Path),
 * request behaviour, authentication, defaults and YAML validation.
 * Credentials are write-only: once saved they show as "saved" and are never
 * sent back to the browser.
 */
import { useEffect, useMemo, useState } from 'react';
import { effectiveBase, joinUrl } from '@workbench/shared/openapi';
import { DUPLICATE_POLICIES, SettingsValidationError, VALIDATION_MODES, sanitizeSettings } from '@workbench/shared/settings';
import { Badge, Button, ChipsInput, Field, Icon, IconButton, Select, Switch, TextInput, useToast } from '../../ui/index.jsx';
import { useAppState } from '../../state/AppState.jsx';
import { toUserError } from '../../services/errors.js';
import { readPref, writePref } from '../../state/prefs.js';
import { StoragePanel } from '../workbench/SidebarPanels.jsx';

const SECTIONS = [
  ['connection', 'Connection', 'globe'],
  ['request', 'Requests', 'sliders'],
  ['auth', 'Authentication', 'key'],
  ['defaults', 'Defaults', 'settings'],
  ['validation', 'YAML validation', 'shield'],
  ['storage', 'Your workspace', 'folder'],
];

const VIEW_LABELS = { ppi: 'PPI Only', split: 'Side by Side', swagger: 'Swagger Only' };
const MODE_TEXT = {
  strict: { title: 'Strict', text: 'Must be OpenAPI 3.x or Swagger 2.0, and any warning blocks the upload.' },
  standard: { title: 'Standard', text: 'Must be OpenAPI 3.x or Swagger 2.0. Warnings are shown but the file is saved.' },
  lenient: { title: 'Lenient', text: 'Any valid YAML object is accepted. APIs are listed when the file has "paths".' },
};
const DUPLICATE_TEXT = { replace: 'Replace the existing file', rename: 'Keep both (add a number to the new name)', reject: 'Reject the new file' };

const clone = (v) => JSON.parse(JSON.stringify(v));
let envSeq = 0;

function SecretInput({ id, label, isSet, value, onChange, help }) {
  const cleared = value === null;
  return (
    <Field
      id={id}
      label={label}
      help={help}
      labelAction={isSet && !cleared && value === undefined ? <Badge tone="good">Saved</Badge> : cleared ? <Badge tone="warn">Will be removed</Badge> : null}
    >
      <div className="row">
        <TextInput
          id={id}
          type="password"
          autoComplete="new-password"
          value={typeof value === 'string' ? value : ''}
          placeholder={isSet && value === undefined ? '•••••••• (saved — type to replace)' : 'Not set'}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        />
        {isSet && !cleared && (
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            Remove
          </Button>
        )}
        {cleared && (
          <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>
            Undo
          </Button>
        )}
      </div>
    </Field>
  );
}

export default function SettingsPage({ wb, exampleEndpointPath, exampleServers = [], onDone }) {
  const toast = useToast();
  const { settings, saveSettings, source, settingsStatus, settingsError } = useAppState();
  const [draft, setDraft] = useState(() => clone(settings));
  const [secrets, setSecrets] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [defaultProject, setDefaultProject] = useState(() => readPref('defaultProjectId', ''));

  useEffect(() => {
    setDraft(clone(settings));
    setSecrets({});
    setErrors({});
  }, [settings]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(settings) || Object.keys(secrets).length > 0, [draft, settings, secrets]);
  const set = (path, value) =>
    setDraft((d) => {
      const next = clone(d);
      const keys = path.split('.');
      let node = next;
      for (const k of keys.slice(0, -1)) node = node[k];
      node[keys[keys.length - 1]] = value;
      return next;
    });

  const envIndex = Math.max(0, draft.environments.findIndex((e) => e.id === draft.activeEnvironmentId));
  const env = draft.environments[envIndex];
  const example = joinUrl(effectiveBase(env, exampleServers) || '{server from the YAML file}', exampleEndpointPath || '/{endpoint}');

  const save = async () => {
    try {
      sanitizeSettings(draft, settings);
    } catch (err) {
      if (err instanceof SettingsValidationError) {
        setErrors(err.fields);
        toast.error(err.message);
        return;
      }
    }
    setSaving(true);
    try {
      await saveSettings(draft, secrets);
      setErrors({});
      toast.success('Settings saved.');
    } catch (err) {
      const e = toUserError(err);
      if (e.fields) setErrors(e.fields);
      toast.error(e.code === 'SETTINGS_INVALID' ? e.message : 'Settings could not be saved.', { message: e.code === 'SETTINGS_INVALID' ? undefined : e.message });
    } finally {
      setSaving(false);
    }
  };

  const err = (k) => errors[k];

  return (
    <div className="settings">
      <header className="settings-head">
        <div>
          <span className="eyebrow">Application</span>
          <h1>Settings</h1>
        </div>
        <div className="row">
          {dirty && <Badge tone="warn">Unsaved changes</Badge>}
          <Button variant="ghost" onClick={() => (setDraft(clone(settings)), setSecrets({}), setErrors({}))} disabled={!dirty || saving}>
            Discard
          </Button>
          <Button variant="primary" icon="check" onClick={save} loading={saving} disabled={!dirty || !source}>
            Save settings
          </Button>
          <IconButton icon="x" label="Close settings" onClick={onDone} />
        </div>
      </header>

      {settingsStatus === 'error' && (
        <div className="callout bad">
          <Icon name="error" />
          <div>Settings could not be loaded ({settingsError?.message}). Defaults are shown.</div>
        </div>
      )}

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map(([id, label, icon]) => (
            <a key={id} href={`#settings-${id}`} onClick={(e) => (e.preventDefault(), document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: 'smooth' }))}>
              <Icon name={icon} size={14} /> {label}
            </a>
          ))}
        </nav>

        <div className="settings-sections">
          {/* ------------------------------------------------------------ connection */}
          <section id="settings-connection" className="settings-section card">
            <h2>Connection</h2>
            <p className="muted">Requests go to Base URL + Base Path + the endpoint path from the YAML file.</p>

            <div className="env-tabs" role="tablist" aria-label="Environments">
              {draft.environments.map((e, i) => (
                <button
                  key={e.id}
                  type="button"
                  role="tab"
                  aria-selected={i === envIndex}
                  className={i === envIndex ? 'active' : ''}
                  onClick={() => set('activeEnvironmentId', e.id)}
                >
                  {e.name || `Environment ${i + 1}`}
                  {e.id === settings.activeEnvironmentId && <span className="dot" title="Active" />}
                </button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                icon="plus"
                disabled={draft.environments.length >= 20}
                onClick={() => {
                  envSeq += 1;
                  const id = `env-${Date.now().toString(36)}${envSeq}`;
                  setDraft((d) => ({ ...clone(d), environments: [...d.environments, { id, name: `Environment ${d.environments.length + 1}`, baseUrl: '', basePath: '' }], activeEnvironmentId: id }));
                }}
              >
                Add environment
              </Button>
            </div>

            <div className="form-grid">
              <Field id="set-env-name" label="Environment name" error={err(`environments.${envIndex}.name`)}>
                <TextInput id="set-env-name" value={env.name} maxLength={60} onChange={(e) => set(`environments.${envIndex}.name`, e.target.value)} />
              </Field>
              <Field id="set-base-url" label="Base URL" error={err(`environments.${envIndex}.baseUrl`)} help="Leave empty to use the server named in each YAML file.">
                <TextInput
                  id="set-base-url"
                  value={env.baseUrl}
                  placeholder="https://api.example.com"
                  spellCheck={false}
                  onChange={(e) => set(`environments.${envIndex}.baseUrl`, e.target.value)}
                />
              </Field>
              <Field id="set-base-path" label="Base Path / Route" error={err(`environments.${envIndex}.basePath`)} help="Added between the Base URL and every endpoint.">
                <TextInput id="set-base-path" value={env.basePath} placeholder="/api/v1" spellCheck={false} onChange={(e) => set(`environments.${envIndex}.basePath`, e.target.value)} />
              </Field>
            </div>
            <div className="url-example">
              <span className="eyebrow">Example request URL</span>
              <code>{example}</code>
            </div>
            <div className="row-end">
              {draft.environments.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  onClick={() =>
                    setDraft((d) => {
                      const envs = d.environments.filter((_, i) => i !== envIndex);
                      return { ...clone(d), environments: envs, activeEnvironmentId: envs[0].id };
                    })
                  }
                >
                  Remove this environment
                </Button>
              )}
            </div>
            <p className="field-help">The selected environment is the one requests use after you save.</p>
          </section>

          {/* ------------------------------------------------------------ requests */}
          <section id="settings-request" className="settings-section card">
            <h2>Requests</h2>
            <div className="form-grid">
              <Field id="set-timeout" label="Request timeout" help="Requests that take longer are stopped. 1 to 300 seconds." error={err('request.timeoutMs')}>
                <div className="row">
                  <TextInput
                    id="set-timeout"
                    type="number"
                    min={1}
                    max={300}
                    value={Math.round(draft.request.timeoutMs / 1000)}
                    onChange={(e) => set('request.timeoutMs', Number(e.target.value) * 1000)}
                    style={{ maxWidth: 120 }}
                  />
                  <span className="muted">seconds</span>
                </div>
              </Field>
              <Field
                id="set-proxy"
                label="Send requests through the server"
                help={
                  source?.supportsProxy
                    ? 'Recommended. The server adds saved credentials and avoids browser CORS limits.'
                    : 'Not available in the browser-only version; requests are sent from your browser.'
                }
              >
                <Switch id="set-proxy" checked={source?.supportsProxy ? draft.request.useServerProxy : false} disabled={!source?.supportsProxy} onChange={(v) => set('request.useServerProxy', v)} />
              </Field>
            </div>

            <h3 className="eyebrow">Default request headers</h3>
            <p className="field-help">Sent with every API request.</p>
            <div className="header-rows">
              {draft.request.defaultHeaders.map((h, i) => (
                <div className="header-row" key={i}>
                  <Switch checked={h.enabled !== false} onChange={(v) => set(`request.defaultHeaders.${i}.enabled`, v)} label="" />
                  <Field id={`set-h-name-${i}`} error={err(`request.defaultHeaders.${i}.name`)}>
                    <TextInput id={`set-h-name-${i}`} size="sm" aria-label="Header name" placeholder="X-Header-Name" value={h.name} onChange={(e) => set(`request.defaultHeaders.${i}.name`, e.target.value)} />
                  </Field>
                  <Field id={`set-h-value-${i}`} error={err(`request.defaultHeaders.${i}.value`)}>
                    <TextInput id={`set-h-value-${i}`} size="sm" aria-label="Header value" placeholder="value" value={h.value} onChange={(e) => set(`request.defaultHeaders.${i}.value`, e.target.value)} />
                  </Field>
                  <IconButton
                    icon="trash"
                    size="sm"
                    label={`Remove header ${h.name || i + 1}`}
                    onClick={() => setDraft((d) => ({ ...clone(d), request: { ...d.request, defaultHeaders: d.request.defaultHeaders.filter((_, j) => j !== i) } }))}
                  />
                </div>
              ))}
              <Button
                size="sm"
                icon="plus"
                onClick={() => setDraft((d) => ({ ...clone(d), request: { ...d.request, defaultHeaders: [...d.request.defaultHeaders, { name: '', value: '', enabled: true }] } }))}
              >
                Add header
              </Button>
            </div>
          </section>

          {/* ------------------------------------------------------------ auth */}
          <section id="settings-auth" className="settings-section card">
            <h2>Authentication</h2>
            <p className="muted">
              {source?.supportsProxy
                ? 'Credentials are encrypted on the server and only added when the server sends a request. They are never shown again.'
                : 'In the browser-only version, credentials stay in this browser tab and are forgotten when you close it. They are never saved to the shared database.'}
            </p>
            <div className="form-grid">
              <Field id="set-auth-type" label="Type">
                <Select id="set-auth-type" value={draft.auth.type} onChange={(e) => set('auth.type', e.target.value)}>
                  <option value="none">None</option>
                  <option value="bearer">Bearer token</option>
                  <option value="basic">Username and password (Basic)</option>
                  <option value="apiKey">API key</option>
                </Select>
              </Field>
              {draft.auth.type === 'bearer' && (
                <SecretInput id="set-token" label="Token" isSet={settings.auth.tokenSet} value={secrets.token} onChange={(v) => setSecrets((s) => withSecret(s, 'token', v))} />
              )}
              {draft.auth.type === 'basic' && (
                <>
                  <Field id="set-username" label="Username">
                    <TextInput id="set-username" autoComplete="off" value={draft.auth.username} onChange={(e) => set('auth.username', e.target.value)} />
                  </Field>
                  <SecretInput
                    id="set-password"
                    label="Password"
                    isSet={settings.auth.passwordSet}
                    value={secrets.password}
                    onChange={(v) => setSecrets((s) => withSecret(s, 'password', v))}
                  />
                </>
              )}
              {draft.auth.type === 'apiKey' && (
                <>
                  <Field id="set-key-name" label="Key name" error={err('auth.apiKeyName')}>
                    <TextInput id="set-key-name" value={draft.auth.apiKeyName} onChange={(e) => set('auth.apiKeyName', e.target.value)} />
                  </Field>
                  <Field id="set-key-in" label="Send in">
                    <Select id="set-key-in" value={draft.auth.apiKeyIn} onChange={(e) => set('auth.apiKeyIn', e.target.value)}>
                      <option value="header">Header</option>
                      <option value="query">Query string</option>
                    </Select>
                  </Field>
                  <SecretInput
                    id="set-key-value"
                    label="Key value"
                    isSet={settings.auth.apiKeyValueSet}
                    value={secrets.apiKeyValue}
                    onChange={(v) => setSecrets((s) => withSecret(s, 'apiKeyValue', v))}
                  />
                </>
              )}
            </div>
          </section>

          {/* ------------------------------------------------------------ defaults */}
          <section id="settings-defaults" className="settings-section card">
            <h2>Defaults</h2>
            <div className="form-grid">
              <Field id="set-def-project" label="Default project" help="Opened when this browser starts the app without a previous selection. Saved in this browser only.">
                <Select
                  id="set-def-project"
                  value={defaultProject}
                  onChange={(e) => {
                    setDefaultProject(e.target.value);
                    writePref('defaultProjectId', e.target.value);
                  }}
                >
                  <option value="">None</option>
                  {wb.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="set-def-view" label="Default view mode" help="The view the app opens in.">
                <Select id="set-def-view" value={draft.defaults.viewMode} onChange={(e) => set('defaults.viewMode', e.target.value)}>
                  {Object.entries(VIEW_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="set-theme" label="Theme">
                <Select id="set-theme" value={draft.defaults.theme} onChange={(e) => set('defaults.theme', e.target.value)}>
                  <option value="system">Match system</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </Select>
              </Field>
            </div>
          </section>

          {/* ------------------------------------------------------------ validation */}
          <section id="settings-validation" className="settings-section card">
            <h2>YAML validation</h2>
            <p className="muted">Every uploaded file is checked before it is saved. Files that fail are never stored.</p>
            <fieldset className="choice-cards">
              <legend className="field-label">Validation level</legend>
              {VALIDATION_MODES.map((m) => (
                <label key={m} className={`choice${draft.validation.mode === m ? ' selected' : ''}`}>
                  <input type="radio" name="val-mode" value={m} checked={draft.validation.mode === m} onChange={() => set('validation.mode', m)} />
                  <span>
                    <strong>{MODE_TEXT[m].title}</strong>
                    <span className="muted">{MODE_TEXT[m].text}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="form-grid">
              <Field
                id="set-max-size"
                label="Maximum file size"
                error={err('validation.maxFileSizeKb')}
                help={Number.isFinite(source?.maxFileSizeKb) ? `This workspace stores files up to ${source.maxFileSizeKb} KB.` : '1 KB to 20 MB.'}
              >
                <div className="row">
                  <TextInput
                    id="set-max-size"
                    type="number"
                    min={1}
                    max={20480}
                    value={draft.validation.maxFileSizeKb}
                    onChange={(e) => set('validation.maxFileSizeKb', Number(e.target.value))}
                    style={{ maxWidth: 140 }}
                  />
                  <span className="muted">KB</span>
                </div>
              </Field>
              <Field id="set-ext" label="Allowed file extensions" error={err('validation.allowedExtensions')} help="Press Enter after each one, e.g. .yaml">
                <ChipsInput id="set-ext" values={draft.validation.allowedExtensions} onChange={(v) => set('validation.allowedExtensions', v)} placeholder=".yaml" />
              </Field>
              <Field id="set-dup" label="When a file name already exists in the project">
                <Select id="set-dup" value={draft.validation.duplicatePolicy} onChange={(e) => set('validation.duplicatePolicy', e.target.value)}>
                  {DUPLICATE_POLICIES.map((p) => (
                    <option key={p} value={p}>
                      {DUPLICATE_TEXT[p]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </section>

          {source && (
            <section id="settings-storage" className="settings-section card">
              <h2>Your workspace</h2>
              <p className="muted">
                Projects and YAML files are not stored on the server. Each browser keeps its own, so people using the same address only see their own files.
                The settings on this page are shared by everyone who uses this server.
              </p>
              <StoragePanel wb={wb} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function withSecret(s, key, v) {
  const next = { ...s };
  if (v === undefined) delete next[key];
  else next[key] = v;
  return next;
}
