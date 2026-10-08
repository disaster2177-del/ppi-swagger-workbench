# PPI & Swagger Workbench

One application for two jobs:

- **PPI**: the naval radar PPI scope, fed live from Kafka (NMEA 0183, AIS, GeoJSON, canonical JSON) through Socket.IO, with MongoDB history. Full reference: [docs/PPI.md](docs/PPI.md).
- **Swagger / OpenAPI workbench**: project-based YAML management. Upload many OpenAPI 3.x / Swagger 2.0 YAML files per project, store them in MongoDB, browse their APIs, and run any API from a form generated from the YAML.

Both share one shell, one theme (light and dark), one set of components and one Express server.

```
[◧] PPI & Swagger   [PPI Only] [Side by Side] [Swagger Only] | [Settings]        [MongoDB] [◨]
┌ left sidebar ─┐┌────────────────────── main ─────────────────────┐┌ right sidebar ─┐
│ Scope         ││  PPI scope        │ Project [Payment Service ▼] ││ Objects        │
│ Projects      ││                   │ [Upload YAML]                ││ Details        │
│               ││                   │ YAML files │ POST /payments  ││ Rejected       │
│               ││                   │ APIs       │ form → Execute  ││ Activity       │
└───────────────┘└─────────────────────────────────────────────────┘└────────────────┘
```

## What you can do

**View modes.** *PPI Only*, *Side by Side* (default, with a draggable divider) and *Swagger Only*, plus *Settings*. The left sidebar (scope controls, projects) and the right sidebar (PPI objects, details, rejected messages, API activity) each have their own toggle. A closed sidebar is removed and the main area expands. Below 1100 px the sidebars open over the content; below 900 px the panes stack.

**Projects → YAML files → APIs → form.**

1. Pick a project (or create one; projects are database records, never hardcoded).
2. **Upload YAML** stays disabled until a project is selected. It accepts several files at once, or you can drop them on the YAML list.
3. Each file is checked one by one: file type, size, YAML syntax (with line and column), OpenAPI/Swagger structure, and resolvable `$ref`s. Then its endpoints are extracted. Valid files are stored. Invalid files are not stored, and an upload report shows which files succeeded and why the others failed.
4. Changing the project refreshes the YAML list to that project's files only.
5. Selecting a YAML file parses it and lists its APIs, grouped by tag, with coloured method badges. Both lists are searchable: files by name or title; APIs by path, method, summary, operationId or tag.
6. Selecting an API renders its form on the right.

**Dynamic forms.** Everything is read from the YAML. Nothing about a particular API is in the code.

| Schema | Rendered as |
|---|---|
| `enum` (any type) | **dropdown** with the YAML's values, in the YAML's order |
| `boolean` | switch (optional booleans can stay unset) |
| `integer` / `number` | number input with min, max and step |
| `string` | text, email, URL, date, password, textarea or file input, chosen by `format` and `maxLength` |
| array of enums | multi-select dropdown with chips |
| array of strings or numbers | chips input |
| array of objects | repeatable groups with Add and Remove |
| object, nested object | grouped fields; optional groups start collapsed |
| `oneOf` / `anyOf` | a "Choose type" dropdown, then that variant's fields |
| free-form object | JSON editor |

The form covers path, query, header and cookie parameters and the request body, including several content types, JSON / form-urlencoded / multipart, and a **Form ↔ JSON** toggle for JSON bodies. It also understands `$ref`, `allOf`, `nullable`, OpenAPI 3.1 type arrays, `const`, defaults, examples, descriptions, deprecated markers and `readOnly`. Validation covers required, ranges, lengths, `pattern`, `format`, item counts and uniqueness. **Use sample data** fills the form from examples and defaults. DELETE requests ask for confirmation.

**Execute.** The request URL is **Base URL + Base Path + endpoint path**, e.g. `https://api.example.com` + `/api/v1` + `/users` → `https://api.example.com/api/v1/users`. If Settings has no Base URL, the YAML's own server is used. Requests go through the server, which adds stored credentials, enforces the timeout and avoids CORS. The target host always comes from Settings or the YAML, so the proxy cannot be pointed at arbitrary hosts. The response viewer shows status, time and size, a plain-language explanation of error statuses, the body (as a table for JSON lists, as JSON, or raw), headers, and the request as sent with a copyable `curl`.

**Notifications.** Success, warning and error toasts use plain messages, for example "YAML uploaded successfully.", "Invalid YAML format. Unable to parse the uploaded file.", "Invalid OpenAPI/Swagger definition.", "Please select a project before uploading YAML files.", "Please enter all required fields." and "API request failed.". Technical detail is available behind *Technical details* and is never the headline.

**Settings** (stored in MongoDB):

- **Connection**: environments, each with a Base URL and Base Path; one is active. A live example URL is shown.
- **Requests**: timeout, default headers, and whether to send requests through the server.
- **Authentication**: none, Bearer, Basic or API key (header or query). Secrets are write-only, encrypted with AES-256-GCM at rest, and never returned to the browser.
- **Defaults**: default project, default view mode, theme.
- **YAML validation**: Strict, Standard or Lenient; maximum file size; allowed extensions; what to do with duplicate file names (replace, keep both, or reject).

## Data model (MongoDB)

```
projects     _id, name (unique, case-insensitive), slug, description, createdAt, updatedAt
   │ 1..*
yaml_files   _id, project → projects._id, fileName (unique per project), filePath, content,
   │         sizeBytes, format, specVersion, title, apiVersion, endpointCount, warnings,
   │         createdAt, updatedAt
   │ 1..*
endpoints    _id, project → projects._id, yamlFile → yaml_files._id, method, path,
             operationId, summary, description, tags, deprecated, createdAt
app_settings _id "app", data (public settings), secrets (encrypted), updatedAt
```

Deleting a project deletes its YAML files and endpoints. Deleting a YAML file deletes its endpoints.

## Project layout

```
shared/                       used by BOTH server and browser
  openapi/                    parse, validate, normalise (OpenAPI 3 + Swagger 2), schemas,
                              form values (defaults, samples, validation), request builder, messages
  workbench/                  upload pipeline + WorkbenchService (projects/YAML/endpoints rules)
                              written against a store interface; MemoryStore for tests
  settings/                   defaults and sanitising of settings
server/
  src/index.js, app.js        one Express server: PPI API + Socket.IO + /api/workbench
  src/workbench/              Mongo models + store, settings (encrypted secrets), request proxy, routes
  src/kafka, src/services     PPI ingest pipeline (unchanged)
  scripts/seed-workbench.js   load example projects from samples/openapi
client/src/
  App.jsx                     shell: top nav, view modes, sidebars, split view
  ui/                         shared components: Button, Field, Select, Switch, ChipsInput, Modal,
                              Toast, Tabs, MethodBadge, …
  styles/                     tokens.css (one theme, light + dark), base, ui, shell, ppi, workbench, settings
  features/ppi/               the PPI scope and its panels (moved, not rewritten) + usePpiController
  features/workbench/         project bar, upload, YAML/API navigator, SchemaField (dynamic form),
                              OperationForm, ResponseViewer, dialogs, useWorkbench
  features/settings/          Settings page
  services/                   data sources: REST (server + MongoDB), browser-only (artifact DB or memory)
samples/openapi/              example YAML files (valid and invalid) + projects.json for seeding
```

## REST API (workbench)

| method | path | |
|---|---|---|
| GET | `/api/workbench/projects` | projects with YAML and API counts |
| POST | `/api/workbench/projects` | `{ name, description }` |
| PATCH / DELETE | `/api/workbench/projects/:id` | rename, or delete with its files |
| GET | `/api/workbench/projects/:id/yaml-files?search=` | that project's YAML files (no content) |
| POST | `/api/workbench/projects/:id/yaml-files` | multipart `files` (many) → per-file results |
| GET | `/api/workbench/yaml-files/:id` | content and endpoints |
| GET | `/api/workbench/yaml-files/:id/endpoints` | endpoints only |
| DELETE | `/api/workbench/yaml-files/:id` | |
| GET / PUT | `/api/workbench/settings` | PUT body `{ settings, secrets: { token?, password?, apiKeyValue? } }` |
| POST | `/api/workbench/execute` | send a request through the server |

Errors always come back as `{ code, message }`, with `message` safe to show.

The PPI endpoints (`/api/geometries`, `/api/ingest`, …) are unchanged; see [docs/PPI.md](docs/PPI.md#rest-api).

## Run it

Requires Node 20+ and Docker (for Kafka and MongoDB).

```bash
npm install                     # installs shared, server and client (npm workspaces)
cp server/.env.example server/.env   # set SETTINGS_SECRET_KEY to a long random string
npm run infra                   # Kafka + MongoDB containers
npm run seed                    # optional: example projects and YAML files
npm run dev                     # API on :4000, UI on http://localhost:5173
npm run simulate                # optional: live PPI demo traffic
```

Everything in Docker: `docker compose --profile sim up --build`, then open http://localhost:4000.

Browser-only build (no server, used for the hosted preview): `npm run build:demo` writes `client/dist-demo/index.html`. The PPI runs its simulator in the page. Projects and YAML files go to the hosting workspace's database when there is one, otherwise to memory. API requests are sent from the browser.

Tests: `npm test` runs the shared core (parsing, validation, forms, request building, project rules), the server (settings encryption, request proxy, PPI pipeline) and the client geometry tests.
