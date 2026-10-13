# Running without Docker

The app is one Node.js server. It serves the web UI, the Settings API, the API request proxy and the PPI live feed. Docker is not needed. MongoDB and Kafka are optional:

| You install | PPI feed | Settings (Base URL, credentials, …) | PPI history / picture after restart |
|---|---|---|---|
| **Node.js only** (simplest) | built-in simulator (`PPI_SIMULATOR=true`) | JSON file `/var/lib/ppi-workbench/settings.json` | not kept |
| Node.js + MongoDB | built-in simulator or Kafka | MongoDB | kept |
| Node.js + Kafka (+ MongoDB) | your real Kafka topics | file or MongoDB | kept with MongoDB |

Each user's projects and YAML files are stored in **their own browser** (localStorage) in every setup. The server never stores them.

Pick one way to install:

- **A. Offline RHEL server (recommended):** build one bundle on a PC with internet, copy it over, run `install.sh`. Node.js is inside the bundle. Nothing is downloaded on the server.
- **B. A machine with internet** (or an internal npm mirror) and Node.js 22 installed.

---

## A. Offline RHEL 8 / 9 server

### 1. On a Linux PC with internet: build the bundle

Needs Node.js 20+ with npm, curl and git on that PC (any Linux x86_64; WSL on Windows works too).

```bash
git clone https://github.com/disaster2177-del/ppi-swagger-workbench.git
cd ppi-swagger-workbench
./scripts/standalone/make-bundle.sh
```

Result: `dist-standalone/ppi-workbench-standalone-2.0.0-linux-x64.tar.gz`. It contains:

- Node.js 22 for Linux
- the app with all runtime npm packages already installed
- the built web UI
- `install.sh`, a systemd service and a settings template

Options: `NODE_ARCH=linux-arm64` for ARM servers; `NPM_REGISTRY=…` and `NODE_DIST=…` for internal mirrors.

### 2. Copy it to the RHEL server

USB, `scp`, or whatever your network allows:

```bash
scp dist-standalone/ppi-workbench-standalone-*.tar.gz admin@rhel-server:/tmp/
```

### 3. On the RHEL server: install

```bash
cd /tmp
tar xzf ppi-workbench-standalone-*.tar.gz
cd ppi-workbench-standalone-*/
sudo ./install.sh                 # or: sudo ./install.sh --port 8080
```

The installer:

1. checks the Node.js archive (SHA-256)
2. creates the service user `ppiwb`
3. installs Node.js to `/opt/ppi-workbench/node` and the app to `/opt/ppi-workbench/app`
4. creates `/etc/ppi-workbench/ppi-workbench.env` with a random `SETTINGS_SECRET_KEY` (an existing file is kept)
5. installs and starts the systemd service `ppi-workbench`
6. opens the port in firewalld and checks that the app answers

It ends with the address to open, for example `http://10.0.0.15:4000`. Every user opens that address in their browser.

That's all. The default settings run **without MongoDB and without Kafka** (`MONGO_URI=` empty, `PPI_SIMULATOR=true`).

### 4. Change settings

```bash
sudo vi /etc/ppi-workbench/ppi-workbench.env
sudo systemctl restart ppi-workbench
```

| Setting | What it does |
|---|---|
| `PORT=4000` | port of the web UI and API |
| `HOST=` | empty = reachable from other PCs; `127.0.0.1` = this machine only (behind nginx) |
| `MONGO_URI=` | empty = no MongoDB. Set `mongodb://127.0.0.1:27017/naval_geometry` to use MongoDB |
| `PPI_SIMULATOR=true` | built-in demo feed for the PPI. `false` = read Kafka (`KAFKA_BROKERS`) |
| `KAFKA_BROKERS=127.0.0.1:9092` | your Kafka brokers (comma list) when `PPI_SIMULATOR=false` |
| `KAFKA_ENABLED=false` | no PPI feed at all (the PPI stays empty; `/api/ingest` still works) |
| `SETTINGS_SECRET_KEY=…` | encrypts saved API credentials. Don't change it after users have saved credentials |
| `HTTPS_PROXY=…` | proxy the server uses to reach APIs ("Send requests from: The server") |
| `WORKBENCH_ALLOWED_HOSTS=…` | only allow these API hosts through the server (comma list, `*.corp.local` allowed) |
| `NODE_EXTRA_CA_CERTS=…` | extra CA certificate for internal HTTPS APIs |
| `DATA_DIR=/var/lib/ppi-workbench` | where `settings.json` and `settings.key` live |

### 5. Daily use

```bash
systemctl status ppi-workbench          # is it running?
journalctl -u ppi-workbench -f          # live log
sudo systemctl restart ppi-workbench    # after changing settings
curl http://127.0.0.1:4000/api/health   # mongo / kafka / simulator status
```

**Update to a new version:** build a new bundle (step 1), copy it, run `sudo ./install.sh` again. The app and Node.js are replaced. Your settings in `/etc/ppi-workbench` and data in `/var/lib/ppi-workbench` are kept.

**Backup:** `/etc/ppi-workbench/ppi-workbench.env` and `/var/lib/ppi-workbench/`. Users' projects and YAML files are in their browsers: each user can use **Settings → Your workspace → Export**.

**Uninstall:**

```bash
sudo systemctl disable --now ppi-workbench
sudo rm -rf /etc/systemd/system/ppi-workbench.service /opt/ppi-workbench
sudo systemctl daemon-reload
# data and settings (only if you want them gone):
sudo rm -rf /etc/ppi-workbench /var/lib/ppi-workbench && sudo userdel ppiwb
```

---

## B. A machine with internet and Node.js

### 1. Install Node.js 22

Use Node.js **22.21 or newer** (needed for `NODE_USE_ENV_PROXY`). Either:

- the official archive from <https://nodejs.org/en/download> (Linux binaries), unpacked to `/opt/node`, with `/opt/node/bin` added to `PATH`
- or your distribution's package (on RHEL, check `dnf module list nodejs` for a 22 stream)

Check with `node --version`.

### 2. Get the code and install packages

```bash
git clone https://github.com/disaster2177-del/ppi-swagger-workbench.git
cd ppi-swagger-workbench
npm install
```

### 3. Configure

```bash
cp server/.env.example server/.env
```

The template is already set up for running without MongoDB and Kafka (`MONGO_URI=` empty, `PPI_SIMULATOR=true`). Only add a secret key in `server/.env`:

```ini
SETTINGS_SECRET_KEY=<a long random string, e.g. output of: openssl rand -base64 32>
```

> **Which file is read?** `server/.env`. If there is none, the `.env` in the project root (the Docker one) is used. The first lines of the server log name the file and say whether MongoDB and Kafka or the simulator are used:
> ```
> INFO  Configuration: /home/you/ppi-swagger-workbench/server/.env
> INFO    MongoDB:  not used (MONGO_URI is empty) - Settings saved in a file
> INFO    PPI feed: built-in simulator (PPI_SIMULATOR=true) - Kafka not used
> ```
> Values exported in the shell (`export MONGO_URI=…`) win over the file.

> **Created `server/.env` before?** An older copy may still say `MONGO_URI=mongodb://localhost:27017/…` and `PPI_SIMULATOR=false`. Then the server keeps trying Kafka on `localhost:9092` (`ECONNREFUSED` in the log) and can't save Settings. Change those two lines to `MONGO_URI=` and `PPI_SIMULATOR=true`, or copy the template again.

### 4. Build the UI once, then start

```bash
npm run build      # builds the web UI into client/dist
npm start          # server on http://<this-machine>:4000 (serves the UI too)
```

**`npm run build` is not needed every time.** It turns the React source in `client/src` into plain files in `client/dist`, which the server then serves. Run it again only when the client code changed, for example after `git pull`. To restart the app, `npm start` alone is enough. If `client/dist` is missing, the server says so in its log and in the browser.

While you are changing the code yourself, use `npm run dev` instead (see below). It rebuilds automatically on every save.

Stop with Ctrl+C. To keep it running after logout and start it on boot, use the systemd service in `scripts/standalone/ppi-workbench.service`. Change `WorkingDirectory`, `ExecStart` (path to `node`) and `EnvironmentFile` (path to your `server/.env`) to your folders, then:

```bash
sudo cp scripts/standalone/ppi-workbench.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now ppi-workbench
```

Or run `./scripts/standalone/make-bundle.sh` and then `sudo ./install.sh` from the bundle, exactly as in **A**.

### Development (hot reload)

```bash
# server/.env from the template (MONGO_URI= and PPI_SIMULATOR=true). Skip "npm run infra", that one uses Docker.
npm run dev        # API on :4000, UI with hot reload on http://localhost:5173 (no "npm run build" needed)
```

---

## Optional: MongoDB without Docker

Use MongoDB when you want Settings stored in a database, and the PPI picture and track history kept across restarts.

1. **CPU check:** MongoDB 5.0 and newer need AVX. `grep -c avx /proc/cpuinfo` must print more than 0.
2. **On a PC with internet,** download the server RPM for your RHEL version from <https://repo.mongodb.org/yum/redhat/> → `9` (or `8`) → `mongodb-org` → `7.0` → `x86_64` → `RPMS`. You need `mongodb-org-server-7.0.*.el9.x86_64.rpm` (and `mongodb-mongosh-*.rpm` if you want the shell).
3. **On the server:**

   ```bash
   sudo dnf install ./mongodb-org-server-7.0.*.rpm     # its dependencies come from the RHEL media
   sudo systemctl enable --now mongod                  # listens on 127.0.0.1:27017 by default
   ```

4. **In `/etc/ppi-workbench/ppi-workbench.env`:** set `MONGO_URI=mongodb://127.0.0.1:27017/naval_geometry`, then `sudo systemctl restart ppi-workbench`.

Settings saved before (in `settings.json`) are not copied to MongoDB. Enter them again once in **Settings**.

## Optional: Kafka without Docker

Use Kafka to feed the PPI with real data.

1. **Java 17:** `sudo dnf install java-17-openjdk-headless`. It's in RHEL AppStream; offline, use the RHEL ISO as a local repository.
2. **Download Kafka:** on a PC with internet, get `kafka_2.13-3.9.0.tgz` from <https://archive.apache.org/dist/kafka/3.9.0/> and copy it over.
3. **Install it** as a single-node broker (KRaft mode, no ZooKeeper):

   ```bash
   sudo useradd --system --shell /sbin/nologin kafka
   sudo tar xzf kafka_2.13-3.9.0.tgz -C /opt && sudo ln -s /opt/kafka_2.13-3.9.0 /opt/kafka
   sudo mkdir -p /var/lib/kafka && sudo chown kafka: /var/lib/kafka
   sudo sed -i 's|^log.dirs=.*|log.dirs=/var/lib/kafka|' /opt/kafka/config/kraft/server.properties
   sudo -u kafka /opt/kafka/bin/kafka-storage.sh format \
     -t "$(/opt/kafka/bin/kafka-storage.sh random-uuid)" -c /opt/kafka/config/kraft/server.properties
   ```

4. **Create `/etc/systemd/system/kafka.service`:**

   ```ini
   [Unit]
   Description=Apache Kafka
   After=network-online.target

   [Service]
   User=kafka
   ExecStart=/opt/kafka/bin/kafka-server-start.sh /opt/kafka/config/kraft/server.properties
   ExecStop=/opt/kafka/bin/kafka-server-stop.sh
   Restart=on-failure

   [Install]
   WantedBy=multi-user.target
   ```

   Then: `sudo systemctl daemon-reload && sudo systemctl enable --now kafka`

5. **In `/etc/ppi-workbench/ppi-workbench.env`:** set `PPI_SIMULATOR=false` and `KAFKA_BROKERS=127.0.0.1:9092`, then restart `ppi-workbench`. The PPI status bar shows `KAFKA CONNECTED`. The topics are created automatically.

Optional, to test Kafka with the demo traffic:

```bash
cd /opt/ppi-workbench/app/server && sudo -u ppiwb /opt/ppi-workbench/node/bin/node scripts/simulator.js
```

---

## Troubleshooting

| You see | Cause and fix |
|---|---|
| Browser can't open `http://server:4000` | `systemctl status ppi-workbench`; firewall: `sudo firewall-cmd --list-ports` (re-run `install.sh` or add the port); `HOST` must be empty, not `127.0.0.1` |
| `EADDRINUSE` in the log | another program uses the port: change `PORT` |
| PPI empty, status `KAFKA CONNECTING` / `KAFKA ERROR`; log says *Kafka is not reachable at localhost:9092 (… ECONNREFUSED …)* | no Kafka running there. Set `PPI_SIMULATOR=true` (demo feed) or `KAFKA_ENABLED=false` in `server/.env` (or `/etc/ppi-workbench/ppi-workbench.env`), then restart. Use `DEBUG=1` to see every retry |
| Browser shows *The web UI is not built yet* | run `npm run build` once, then `npm start` |
| PPI status `KAFKA DISABLED` | `KAFKA_ENABLED=false` and simulator off: set `PPI_SIMULATOR=true` for the demo feed |
| "Settings could not be saved to …settings.json" | the service user can't write `DATA_DIR`: `sudo chown ppiwb: /var/lib/ppi-workbench` |
| "Settings cannot be saved because the database is not connected" | `MONGO_URI` is set but MongoDB is down: start `mongod`, or empty `MONGO_URI` |
| Log says `MongoDB unavailable` at start | same as above; the app still runs, Settings just can't be saved |
| Saved API credentials stopped working | `SETTINGS_SECRET_KEY` changed: enter the credentials again in Settings |
| `npm run build`: *failed to resolve import "swagger-ui-dist/…"* (or "Missing npm package: …") | `node_modules` is older than the code (a package was added). Run `npm install` once, then build again. This does not change your npm or Node version |
| `GLIBC_2.28 not found` when Node starts | the server is RHEL 7: Node.js 22 needs RHEL 8 or newer |
| Service fails with `status=203/EXEC` | SELinux label or wrong path: `sudo restorecon -R /opt/ppi-workbench`, check `ExecStart` |
