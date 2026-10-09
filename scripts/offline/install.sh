#!/usr/bin/env bash
# =============================================================================
# Install / update PPI & Swagger Workbench on an OFFLINE server (RHEL 8/9).
# Run inside the unpacked bundle folder:   ./install.sh
# Needs: Docker Engine + Docker Compose plugin (see docs/OFFLINE-RHEL.md, step 1).
# Safe to run again for an update: keeps .env and the MongoDB data.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n==> %s\n' "$*"; }
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

say "Checking Docker"
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Install the Docker RPMs first (docs/OFFLINE-RHEL.md, step 1)."; exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "The 'docker compose' plugin is missing. Install docker-compose-plugin (docs/OFFLINE-RHEL.md, step 1)."; exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Cannot talk to the Docker daemon. Start it (sudo systemctl enable --now docker) and/or add your user to the docker group."; exit 1
fi

if ! grep -qw avx /proc/cpuinfo; then
  echo "WARNING: this CPU does not report AVX. MongoDB 7 needs AVX and will not start."
  echo "         Enable AVX for the VM (CPU type 'host' in the hypervisor) or see docs/OFFLINE-RHEL.md (MongoDB without AVX)."
fi

say "Checking the image archive"
if [ -f images.tar.gz.sha256 ]; then sha256sum -c images.tar.gz.sha256; fi

say "Loading images (a few minutes)"
gunzip -c images.tar.gz | docker load

say "Preparing .env"
if [ ! -f .env ]; then
  cp .env.example .env
  KEY="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
  sed -i "s|^SETTINGS_SECRET_KEY=.*|SETTINGS_SECRET_KEY=${KEY}|" .env
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [ -n "${IP}" ] && sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=http://${IP}:4000|" .env
  echo "Created .env with a new SETTINGS_SECRET_KEY. Keep this file; it is needed to read saved credentials."
else
  # Update only the image tag; keep everything else (secret key, ports, ...)
  NEW_VERSION="$(sed -n 's/^APP_VERSION=//p' .env.example)"
  sed -i "s|^APP_VERSION=.*|APP_VERSION=${NEW_VERSION}|" .env
  echo "Kept existing .env (APP_VERSION=${NEW_VERSION})."
fi

PORT="$(sed -n 's/^APP_PORT=//p' .env)"; PORT="${PORT:-4000}"
if command -v firewall-cmd >/dev/null 2>&1 && ${SUDO} firewall-cmd --state >/dev/null 2>&1; then
  say "Opening port ${PORT}/tcp in firewalld"
  ${SUDO} firewall-cmd --permanent --add-port="${PORT}/tcp" >/dev/null && ${SUDO} firewall-cmd --reload >/dev/null
fi

say "Starting containers (no internet access needed)"
docker compose up -d --pull never

say "Status"
sleep 5
docker compose ps
echo
echo "Open:  $(sed -n 's/^PUBLIC_URL=//p' .env)   (the app needs ~30 s to become healthy)"
echo "Logs:  docker compose logs -f app"
