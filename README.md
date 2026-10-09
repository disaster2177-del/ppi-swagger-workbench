# PPI & Swagger Workbench

One application for two jobs:

- **PPI**: the naval radar PPI scope, fed live from Kafka (NMEA 0183, AIS, GeoJSON, canonical JSON) through Socket.IO, with MongoDB history. Full reference: [docs/PPI.md](docs/PPI.md).
- **Swagger / OpenAPI workbench**: project-based YAML management. Upload many OpenAPI 3.x / Swagger 2.0 YAML files per project, browse their APIs, and run any API from a form generated from the YAML.

Both share one shell, one theme (light and dark), one set of components and one Express server. It is built to run in Docker on a VM that many people open from their own PCs: see **[docs/DEPLOY.md](docs/DEPLOY.md)**.

**Each user's projects and YAML files are stored in their own browser (`localStorage`), not on the server.** If PC 1 uploads 5 files and PC 2 uploads 3, PC 1 sees its 5 and PC 2 its 3. Nobody sees a combined list. A reload reopens the user's workspace and last selection.

```
[◧] PPI & Swagger   [PPI Only] [Side by Side] [Swagger Only] | [Settings]   [Saved in this browser] [◨]
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

1. Pick a project, create one, or use **Load example projects**. Projects are records in this browser's workspace, never hardcoded.
2. **Upload YAML** stays disabled until a project is selected. It accepts several files at once, or you can drop them on the YAML list.
3. Each file is checked one by one: file type, size, YAML syntax (with line and column), OpenAPI/Swagger structure, and resolvable `$ref`s. Then its endpoints are extracted. Valid files are saved in this browser. Invalid files are not saved, and an upload report shows which files succeeded and why the others failed. A full browser storage is reported per file and leaves the other files intact.
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

**Execute.** The request URL is **Base URL + Base Path + endpoint path + query**, e.g. `https://api.example.com` + `/api/v1` + `/users` + `?limit=20` → `https://api.example.com/api/v1/users?limit=20`. If Settings has no Base URL, the YAML's own server is used (`servers[0]`, or `host` + `basePath` for Swagger 2). Requests go through the server, which adds stored credentials, enforces the timeout, honours `HTTPS_PROXY` and avoids CORS. When the server can't reach the API, the error names the host, the URL and the reason (DNS, refused, proxy or firewall, certificate), and offers **Send from my browser instead**. Set Base URL to `http://<host>:4000/api/workbench/echo` to see exactly what the proxy sends. The response viewer shows status, time and size, a plain-language explanation of error statuses, the body (as a table for JSON lists, as JSON, or raw), headers, and the request as sent with a copyable `curl`.

**Notifications.** Success, warning and error toasts use plain messages, for example "YAML uploaded successfully.", "Invalid YAML format. Unable to parse the uploaded file.", "Invalid OpenAPI/Swagger definition.", "Please select a project before uploading YAML files.", "Please enter all required fields." and "API request failed.". Technical detail is available behind *Technical details* and is never the headline.

**Settings** (shared by everyone using the server, stored in MongoDB):

- **Connection**: environments, each with a Base URL and Base Path; one is active. A live example URL is shown.
- **Requests**: timeout, default headers, and whether to send requests through the server.
- **Authentication**: none, Bearer, Basic or API key (header or query). Secrets are write-only, encrypted with AES-256-GCM at rest, and never returned to the browser.
- **Defaults**: default view mode, theme. The default project is chosen per browser.
- **Your workspace**: storage used in this browser, plus **Export**, **Import** and **Clear**.
- **YAML validation**: Strict, Standard or Lenient; maximum file size; allowed extensions; what to do with duplicate file names (replace, keep both, or reject).

## Where data lives

```
Browser (each PC / profile, localStorage)          Server (VM, MongoDB)
  ppiwb.v1.projects          [ { id, name, slug,    app_settings  _id "app", data (shared settings),
                               description,                     secrets (AES-256-GCM), updatedAt
                               createdAt, updatedAt } ]
  ppiwb.v1.yamlFiles         [ { id, projectId → project,       geometries / geometry events (PPI)
                               fileName (unique per project),
                               filePath, sizeBytes, format, specVersion, title,
                               apiVersion, endpointCount, warnings,
                               createdAt, updatedAt } ]
  ppiwb.v1.yaml.<id>         YAML text
  ppiwb.v1.endpoints.<id>    [ { method, path, operationId, summary, tags, deprecated } ]
```

Project 1 → * YAML file 1 → * endpoint. Deleting a project deletes its YAML files and endpoints; deleting a file deletes its endpoints. All of this happens only in the current browser.

## Project layout

```
shared/                       used by BOTH server and browser
  openapi/                    parse, validate, normalise (OpenAPI 3 + Swagger 2), schemas,
                              form values (defaults, samples, validation), request builder, messages
  workbench/                  upload pipeline + WorkbenchService (projects/YAML/endpoints rules)
                              written against a store interface; localStorage store (browsers),
                              MemoryStore (tests); workspace export / import
  settings/                   defaults and sanitising of settings
server/
  src/index.js, app.js        one Express server: PPI API + Socket.IO + /api/workbench
  src/workbench/              shared settings (Mongo, encrypted secrets), request proxy with clear
                              network errors, example files, echo test target
  src/kafka, src/services     PPI ingest pipeline (unchanged)
client/src/
  App.jsx                     shell: top nav, view modes, sidebars, split view
  ui/                         shared components: Button, Field, Select, Switch, ChipsInput, Modal,
                              Toast, Tabs, MethodBadge, …
  styles/                     tokens.css (one theme, light + dark), base, ui, shell, ppi, workbench, settings
  features/ppi/               the PPI scope and its panels (moved, not rewritten) + usePpiController
  features/workbench/         project bar, upload, YAML/API navigator, SchemaField (dynamic form),
                              OperationForm, ResponseViewer, dialogs, useWorkbench
  features/settings/          Settings page
  services/                   workspace.js (this browser's projects/YAML), serverBackend.js (settings +
                              proxy on the VM), browserBackend.js (browser-only build)
samples/openapi/              example YAML files (valid and invalid) + projects.json ("Load example projects")
docs/DEPLOY.md                running on a VM with Docker, storage, proxies, troubleshooting
```

## REST API (workbench)

| method | path | |
|---|---|---|
| GET / PUT | `/api/workbench/settings` | shared settings; PUT body `{ settings, secrets: { token?, password?, apiKeyValue? } }` |
| POST | `/api/workbench/execute` | send a request through the server: `{ method, path, query: [[k, v]], headers, body, serverUrl }` |
| GET | `/api/workbench/samples` | example projects and YAML files |
| ANY | `/api/workbench/echo/...` | echoes the request back (test target) |

Errors always come back as `{ code, message, details? }`, with `message` safe to show. A 502 from `/execute` means the server could not reach the target API; `details.url` and `details.reason` say which URL and why.

The PPI endpoints (`/api/geometries`, `/api/ingest`, …) are unchanged; see [docs/PPI.md](docs/PPI.md#rest-api).

## Run it

**On a VM (Docker):** see [docs/DEPLOY.md](docs/DEPLOY.md). In short: `cp .env.example .env`, set `SETTINGS_SECRET_KEY`, then `docker compose up -d --build` and open `http://<vm-address>:4000`.

**For development** (Node 20+, Docker for Kafka and MongoDB):

```bash
npm install                     # installs shared, server and client (npm workspaces)
cp server/.env.example server/.env   # set SETTINGS_SECRET_KEY to a long random string
npm run infra                   # Kafka + MongoDB containers
npm run dev                     # API on :4000, UI on http://localhost:5173
npm run simulate                # optional: live PPI demo traffic
```

If your network needs a proxy to reach the APIs you execute, start the server with `HTTPS_PROXY=… NODE_USE_ENV_PROXY=1`.

Browser-only build (no server, used for the hosted preview): `npm run build:demo` writes `client/dist-demo/index.html`. The PPI runs its simulator in the page, settings stay in the browser, and API requests are sent from the browser.

Tests: `npm test` runs the shared core (parsing, validation, forms, request building, project rules), per-browser workspace isolation (the PC 1 / PC 2 scenario), the server (settings encryption, request URL building, network error reporting, PPI pipeline) and the client geometry tests.
