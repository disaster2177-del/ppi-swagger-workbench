# Offline installation on RHEL

This guide installs PPI & Swagger Workbench on a **RHEL 8 or 9 server with no internet access** (air-gapped), using Docker.

You need two machines:

| Machine | Internet | What happens there |
|---|---|---|
| **Build machine**: any Linux with Docker (can be your laptop with Docker Desktop) | yes | Builds the app image, downloads MongoDB and Kafka images, packs everything into **one `.tar.gz` file** |
| **RHEL server** | no | Installs Docker from RPM files, loads the images, runs the app |

Once installed, nothing in the app needs the internet:

- **Browser side:** no CDNs and no web fonts. React, Turf.js, Socket.IO and the example YAML files are all inside the app.
- **Users' data:** projects and YAML files stay in each user's browser.
- **Server side:** MongoDB and Kafka run as local containers.

---

## What needs internet, and when

| Item | Needed for | Where it comes from | Offline solution |
|---|---|---|---|
| npm packages (React, Vite, Express, Mongoose, kafkajs, …) | building the app image | registry.npmjs.org | built on the build machine, shipped **inside** the app image |
| `node:22-alpine` | base of the app image | Docker Hub | already inside the app image |
| `mongo:7.0` | database (PPI history, shared Settings) | Docker Hub | shipped in the bundle (`images.tar.gz`) |
| `apache/kafka:3.9.0` | PPI live feed | Docker Hub | shipped in the bundle |
| `provectuslabs/kafka-ui:v0.7.2` | optional Kafka browser | Docker Hub | add with `WITH_KAFKA_UI=1` when making the bundle |
| Docker Engine + Compose plugin | running containers | download.docker.com | RPM files, step 1 |
| Web fonts | none | (removed) | the app uses fonts installed on each user's PC |

---

## Step 0: on the build machine (with internet)

```bash
git clone https://github.com/disaster2177-del/ppi-swagger-workbench.git
cd ppi-swagger-workbench

# Recommended once: pin exact package versions so every build is identical.
docker run --rm -v "$PWD":/app -w /app node:22-alpine npm install --package-lock-only --no-audit --no-fund
git add package-lock.json && git commit -m "Pin dependency versions"   # optional, keeps it for next time

# Build the bundle (x86_64 server). Use PLATFORM=linux/arm64 for an ARM server.
./scripts/offline/make-bundle.sh
```

Result: `dist-offline/ppi-workbench-offline-<version>.tar.gz` (about 400–600 MB). This one file is everything the server needs apart from Docker itself.

If your company has an internal npm mirror (Nexus, Artifactory, Verdaccio), the build machine does not need public internet for npm:

```bash
NPM_REGISTRY=https://nexus.example.local/repository/npm-group/ ./scripts/offline/make-bundle.sh
```

---

## Step 1: Docker on the RHEL server (offline)

Skip this step if `docker compose version` already works on the server.

### 1a. Download the RPMs, on a RHEL machine **with** internet

Use the **same RHEL major version** as the server (8 or 9), ideally a clean minimal install, so the downloaded dependencies match.

```bash
sudo dnf -y install dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
mkdir docker-rpms
sudo dnf download --resolve --destdir docker-rpms \
  docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
tar czf docker-rpms.tar.gz docker-rpms
```

### 1b. Install on the offline server

```bash
tar xzf docker-rpms.tar.gz
sudo dnf -y install --disablerepo='*' ./docker-rpms/*.rpm
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"      # then log out and in again
docker compose version              # must print a version
```

If `dnf` reports a missing dependency (usually `container-selinux`), it comes from the RHEL **AppStream** repository. Install it from your RHEL ISO or Satellite, or download it in step 1a as well.

> **Podman instead of Docker?** RHEL ships Podman. It can run this bundle (`podman load`, then `podman compose` / `podman-compose`), but `podman-compose` comes from EPEL and behaves slightly differently (health checks, `host-gateway`). Docker CE is the tested and easiest route.

---

## Step 2: install the app (offline)

Copy `ppi-workbench-offline-<version>.tar.gz` to the server (USB drive, `scp` from a jump host, …), then:

```bash
tar xzf ppi-workbench-offline-<version>.tar.gz
cd ppi-workbench-offline-<version>
./install.sh
```

`install.sh`:

1. Checks Docker, the Compose plugin and the CPU (MongoDB 7 needs AVX).
2. Verifies and loads the images (`docker load`).
3. Creates `.env` with a random `SETTINGS_SECRET_KEY` and `PUBLIC_URL=http://<server-ip>:4000`.
4. Opens port 4000 in `firewalld`.
5. Starts everything with `docker compose up -d --pull never`. It never tries to download.

Open `http://<server-ip>:4000` from a PC on the same network.

---

## Step 3: settings you may change (`.env` in the bundle folder)

| Key | Default | Change when |
|---|---|---|
| `APP_PORT` | `4000` | another port is wanted (then also `PUBLIC_URL`, and `sudo firewall-cmd --permanent --add-port=<port>/tcp && sudo firewall-cmd --reload`) |
| `PUBLIC_URL` | `http://<server-ip>:4000` | users reach the server by a hostname |
| `SETTINGS_SECRET_KEY` | random (set by install.sh) | **never change after first start**; it decrypts saved API credentials |
| `WORKBENCH_ALLOWED_HOSTS` | empty = any host | you want the server to call only certain internal APIs |
| `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` | empty | not needed offline; only if internal APIs sit behind a proxy |
| `NODE_EXTRA_CA_CERTS` | empty | internal APIs use your company CA (see DEPLOY.md, "Company CA certificate") |
| `KAFKA_BIND` / `KAFKA_EXTERNAL_HOST` | `127.0.0.1` / `localhost` | radar systems on other machines publish to this Kafka |
| `MONGO_IMAGE`, `KAFKA_IMAGE`, `APP_VERSION` | set by the bundle | you load images with other names or versions |

Apply changes with `docker compose up -d --pull never`.

---

## Updating to a new version

On the build machine: `git pull`, then `./scripts/offline/make-bundle.sh` (set `VERSION=…` if you want a specific tag). On the server:

```bash
tar xzf ppi-workbench-offline-<new-version>.tar.gz
cp ppi-workbench-offline-<old-version>/.env ppi-workbench-offline-<new-version>/
cd ppi-workbench-offline-<new-version> && ./install.sh
```

`install.sh` keeps your `.env` (only `APP_VERSION` changes). MongoDB data lives in the Docker volume `mongo-data` and is kept. Users' projects and YAML files are in their browsers and are not affected.

Back up the server data (shared Settings and PPI history):

```bash
docker exec mongo mongodump --archive --gzip > mongo-backup-$(date +%F).gz
# restore:  docker exec -i mongo mongorestore --archive --gzip --drop < mongo-backup-YYYY-MM-DD.gz
```

---

## Every dependency, and where to change it

To update a dependency: edit the file below on the build machine, rebuild the bundle (step 0), and install it on the server (step 2). Nothing is ever changed on the server itself.

### Container images

| Dependency | Version | File / line to change | Notes |
|---|---|---|---|
| Node.js (app runtime and build) | 22 (alpine) | `Dockerfile`: `ARG NODE_IMAGE=node:22-alpine`, or `.env`: `NODE_IMAGE` | Node ≥ 22.21 needed for `NODE_USE_ENV_PROXY`. Any Node 20+ runs the app |
| MongoDB | 7.0 | `docker-compose.yml`: `MONGO_IMAGE` default; `.env`: `MONGO_IMAGE`; `scripts/offline/make-bundle.sh`: `THIRD_PARTY` | Needs a CPU with AVX. Without AVX use `mongo:4.4` (set in all three places) |
| Apache Kafka | 3.9.0 | `docker-compose.yml`: `KAFKA_IMAGE`; `.env`; `make-bundle.sh`: `THIRD_PARTY` | KRaft mode, no ZooKeeper |
| Kafka UI (optional) | v0.7.2 | `docker-compose.yml`: service `kafka-ui`; `make-bundle.sh` | only with `--profile tools` |

### npm packages (built into the app image)

| Package | Version | File | Used for |
|---|---|---|---|
| express | ^5.2.1 | `server/package.json` | web server and REST API |
| mongoose | ^9.10.3 | `server/package.json` | MongoDB (Settings, PPI history) |
| kafkajs | ^2.2.4 | `server/package.json` | Kafka consumer for the PPI |
| socket.io | ^4.8.4 | `server/package.json` | live PPI updates to browsers |
| multer | ^2.0.2 | `server/package.json` | multipart uploads in the request proxy |
| cors, dotenv | ^2.8.6, ^18.0.5 | `server/package.json` | CORS headers, `.env` loading |
| yaml | ^2.8.0 | `shared/package.json` | YAML / OpenAPI parsing (server and browser) |
| react, react-dom | ^19.3.0 | `client/package.json` | user interface |
| socket.io-client | ^4.8.4 | `client/package.json` | live PPI updates |
| @turf/* (8 packages) | ^7.4.0 | `client/package.json` | geodesic PPI engine |
| vite, @vitejs/plugin-react, vite-plugin-singlefile, vitest | ^8.3.1, ^6.1.1, ^2.3.3, ^5.0.3 | `client/package.json` (devDependencies) | build and tests only, not in the running app |
| concurrently | ^10.0.5 | `package.json` (root, devDependency) | `npm run dev` only |

`^` allows newer minor versions at build time. For identical builds, commit `package-lock.json` (step 0). The Dockerfile then uses `npm ci` with exactly those versions. To upgrade one package on the build machine: `docker run --rm -v "$PWD":/app -w /app node:22-alpine npm install <package>@<version> --workspace <server|client|shared>`, commit, rebuild the bundle.

### RHEL packages (installed once, step 1)

`docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, `docker-compose-plugin`, plus their dependencies (usually `container-selinux`, `libcgroup`, `fuse-overlayfs`, `slirp4netns`). Nothing else: Node.js, MongoDB and Kafka do **not** need to be installed on RHEL, because they run in containers.

---

## Offline behaviour of the app

- **Execute → Send requests from: Your browser** (default). The user's PC calls the API directly, so it only reaches APIs on networks that PC can reach. The API must allow CORS for `http://<server-ip>:4000`.
- **Execute → Send requests from: The server (VM)**. The RHEL server calls the API. It reaches whatever the server's network allows, and needs no CORS.
- Public addresses (`*.example.com`, internet APIs) fail offline with a clear "could not be found" message. That is expected.
- **Load example projects** works offline: the example YAML files are inside the app.
- The PPI scope runs fully locally. Without a radar feed, start the built-in simulator with `docker compose --profile sim up -d --pull never`.

---

## Troubleshooting on RHEL

| Symptom | Check / fix |
|---|---|
| `install.sh`: "Cannot talk to the Docker daemon" | `sudo systemctl enable --now docker`; log out and in after `usermod -aG docker` |
| `mongo` container restarts, log shows `Illegal instruction` | CPU without AVX. Give the VM the host CPU model (KVM: CPU mode `host-passthrough`; VMware: enable EVC with AVX) or use `MONGO_IMAGE=mongo:4.4` (step "Every dependency") |
| Page does not open from other PCs | `sudo firewall-cmd --list-ports` should list `4000/tcp`; check cloud/VMware firewall rules |
| `app` unhealthy, log shows "MongoDB unavailable" | `docker compose logs mongo`; the app still serves the UI and PPI but Settings cannot be saved |
| SELinux denials when mounting a CA file | add `:Z` to the bind mount, e.g. `/etc/pki/ca-trust/source/anchors/company.pem:/certs/ca.pem:ro,Z` |
| `docker compose up` tries to pull | always run it with `--pull never` offline, and check `docker images` lists every image in `IMAGES.txt` |
| Wrong time in PPI | the PPI uses message timestamps; keep the server clock in sync with your internal NTP (`chronyc sources`) |

---

## Without Docker (not recommended)

You can run it directly on RHEL, but you must provide each part yourself, offline:

- **Node.js:** the 22 LTS `linux-x64` tarball from nodejs.org, unpacked to `/opt/node`.
- **App files:** on the build machine run `npm ci && npm run build`, then copy the whole folder including `node_modules`. No package uses native code, so the folder works on RHEL x86_64.
- **MongoDB:** the 7.0 RPMs from repo.mongodb.org.
- **Kafka:** the 3.9 tarball, plus Java 17 (`java-17-openjdk` from RHEL).
- **Service:** a `systemd` unit running `node server/src/index.js` with the settings from `server/.env.example`.

The Docker bundle does all of this for you, which is why it is the recommended route.
