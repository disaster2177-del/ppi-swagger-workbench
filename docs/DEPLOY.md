# Deploying on a VM with Docker

The whole app (UI + API + Socket.IO) runs in one container, next to Kafka and MongoDB containers. Users open one URL from any PC.

## 1. Prerequisites on the VM

- Docker Engine 24+ with the Compose plugin (`docker compose version`).
- The app port (default **4000**) open in the VM firewall / security group for the users' network.
- Outbound access from the VM to the APIs you want to execute (directly or through a proxy).

## 2. Install and start

```bash
git clone https://github.com/disaster2177-del/ppi-swagger-workbench.git
cd ppi-swagger-workbench
cp .env.example .env
openssl rand -base64 32          # paste the output into SETTINGS_SECRET_KEY in .env
nano .env                        # set PUBLIC_URL (e.g. http://10.20.30.40:4000), proxy if needed
docker compose up -d --build     # add --profile sim for live PPI demo traffic
docker compose ps                # app should become "healthy"
```

Open `http://<vm-address>:4000`. Logs: `docker compose logs -f app`.

Update to a new version:

```bash
git pull && docker compose up -d --build
```

## 3. What is stored where

| Data | Where | Shared between users? |
|---|---|---|
| Projects, YAML files, endpoints | Each user's **browser** (`localStorage`, keys `ppiwb.v1.*`) | **No.** PC 1 sees only its files, PC 2 only its own |
| Last selected project / API, default project, sidebar layout | Each user's browser | No |
| Settings (environments, Base URL / Base Path, timeout, headers, auth, validation) | MongoDB on the VM | **Yes**, one set for everyone |
| API credentials from Settings | MongoDB, AES-256-GCM encrypted with `SETTINGS_SECRET_KEY` | Used by the server for everyone; never sent to browsers |
| PPI live picture and history | Kafka → server memory, MongoDB | Yes |

Things to know about browser storage:

- A workspace belongs to one **browser profile + address**. Chrome and Edge on the same PC are separate workspaces, and so are `http://10.20.30.40:4000` and `http://ppi-vm:4000`. Give users one fixed URL.
- Browsers allow about **5 MB** per site. The Projects sidebar shows how much is used. Large YAML collections may need trimming.
- Clearing browser data, or a private window, removes the workspace. Users can **Export** their workspace to a file and **Import** it on another PC or browser (Projects sidebar, or Settings → Your workspace).

If you later want one central list of YAML files per user (shared across their PCs), that needs logins and server-side storage. The upload and validation logic is shared code, so a server store can be added back behind the same interface.

## 4. Executing APIs from the VM

Settings → Requests → **Send requests from** decides who calls the API:

- **Your browser** (default): DevTools → Network shows the real `GET` / `POST` / `PUT` / `DELETE` to the API. The user's PC must reach the API, and the API must send CORS headers allowing the app's address (`Access-Control-Allow-Origin`). Credentials for this mode stay in the user's browser tab.
- **The server (VM)**: DevTools shows `POST /api/workbench/execute`; the VM calls the API. No CORS needed, credentials are stored encrypted on the server, but the **VM** has to reach the API (table below).

If one way fails, the error card offers to try the other way.

| Message in the app | Cause | Fix |
|---|---|---|
| *The host "api.example.com" could not be found* | DNS: the name does not exist, or the VM cannot resolve it. `*.example.com` hosts from sample YAML files are placeholders with no real server. | Set the real **Base URL** in Settings, or fix the server in the YAML. |
| *localhost:3000 refused the connection* | Inside a container, `localhost` is the container itself. | Use the VM's IP, or `http://host.docker.internal:3000` for services on the VM. |
| *Could not connect … firewall or a missing outbound proxy* | The VM has no direct route out. | Set `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` in `.env` and restart (`docker compose up -d`). |
| *The TLS certificate … is not trusted* | The API uses a company CA. | Mount the CA file and set `NODE_EXTRA_CA_CERTS`, see below. |
| *not allowed to call "host"* | `WORKBENCH_ALLOWED_HOSTS` is set and the host is not in it. | Add the host to the list. |

When the server cannot reach an API but the user's PC can (an API on the user's own network, for example), the error card has **Send from my browser instead**. The API must allow cross-origin requests (CORS) for that.

**Test the whole path without a real API.** Set Base URL to `http://localhost:4000/api/workbench/echo` in Settings and execute any endpoint. The response shows exactly the method, path, query and headers the proxy sent.

Company CA certificate:

```yaml
# docker-compose.override.yml
services:
  app:
    volumes:
      - /etc/ssl/certs/company-ca.pem:/certs/company-ca.pem:ro
```

and in `.env`: `NODE_EXTRA_CA_CERTS=/certs/company-ca.pem`.

## 5. Security notes

- MongoDB and Kafka are published on the VM's loopback only. Only the app port faces users.
- The request proxy can call any host the VM can reach. Restrict it with `WORKBENCH_ALLOWED_HOSTS` on shared networks. Cloud metadata addresses (`169.254.x.x`) are always refused.
- There are no user accounts. Anyone who can open the URL can change the shared Settings. Put the app behind your SSO or reverse proxy if that matters.
- For HTTPS, put a reverse proxy (nginx, Traefik, Caddy) in front, set `APP_BIND=127.0.0.1`, and set `PUBLIC_URL` to the https address.
