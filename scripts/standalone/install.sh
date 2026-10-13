#!/usr/bin/env bash
# =============================================================================
# Install or upgrade PPI & Swagger Workbench WITHOUT Docker (RHEL 8/9, offline).
# Run as root from the unpacked bundle folder:
#
#     sudo ./install.sh                 # install / upgrade and start
#     sudo ./install.sh --port 8080     # use another port (first install only)
#     sudo ./install.sh --no-firewall   # do not open the port in firewalld
#
#   /opt/ppi-workbench/node                     Node.js (shipped in the bundle)
#   /opt/ppi-workbench/app                      the application (replaced on upgrade)
#   /etc/ppi-workbench/ppi-workbench.env        your settings (kept on upgrade)
#   /var/lib/ppi-workbench                      data: settings.json, settings.key (kept)
#   systemd service: ppi-workbench
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"

PREFIX=/opt/ppi-workbench
CONF_DIR=/etc/ppi-workbench
CONF="${CONF_DIR}/ppi-workbench.env"
DATA=/var/lib/ppi-workbench
SVC_USER=ppiwb
PORT_ARG=""
FIREWALL=1
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT_ARG="$2"; shift 2 ;;
    --no-firewall) FIREWALL=0; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

say() { printf '\n==> %s\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo ./install.sh"; exit 1; }
command -v systemctl >/dev/null || { echo "systemd is required."; exit 1; }

NODE_TAR="$(ls node-v*-linux-*.tar.xz 2>/dev/null | head -1)"
[ -n "${NODE_TAR}" ] || { echo "Node.js archive not found in this folder."; exit 1; }
[ -d app/server/src ] || { echo "app/ folder not found - run this from the unpacked bundle."; exit 1; }

case "$(uname -m)" in
  x86_64) [[ "${NODE_TAR}" == *linux-x64* ]] || { echo "This bundle is not for x86_64."; exit 1; } ;;
  aarch64) [[ "${NODE_TAR}" == *linux-arm64* ]] || { echo "This bundle is not for ARM64."; exit 1; } ;;
esac

say "1/6 Checking the bundle"
if [ -f "${NODE_TAR}.sha256" ]; then sha256sum -c "${NODE_TAR}.sha256"; fi

say "2/6 Service user '${SVC_USER}'"
if ! id "${SVC_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${DATA}" --shell /sbin/nologin "${SVC_USER}"
fi

say "3/6 Installing Node.js and the app in ${PREFIX}"
systemctl stop ppi-workbench 2>/dev/null || true
mkdir -p "${PREFIX}"
rm -rf "${PREFIX}/node.new" && mkdir -p "${PREFIX}/node.new"
tar -xJf "${NODE_TAR}" -C "${PREFIX}/node.new" --strip-components=1
rm -rf "${PREFIX}/node" && mv "${PREFIX}/node.new" "${PREFIX}/node"
rm -rf "${PREFIX}/app.new" && cp -a app "${PREFIX}/app.new"
rm -rf "${PREFIX}/app" && mv "${PREFIX}/app.new" "${PREFIX}/app"
chown -R root:root "${PREFIX}"
"${PREFIX}/node/bin/node" --version
# SELinux: label the files like other system software so systemd may run them.
command -v restorecon >/dev/null && restorecon -R "${PREFIX}" || true

say "4/6 Settings (${CONF}) and data (${DATA})"
mkdir -p "${CONF_DIR}" "${DATA}"
chown "${SVC_USER}:${SVC_USER}" "${DATA}"
chmod 700 "${DATA}"
if [ ! -f "${CONF}" ]; then
  cp ppi-workbench.env "${CONF}"
  KEY="$(head -c 32 /dev/urandom | base64 | tr -d '\n/+=' | head -c 40)"
  sed -i "s|^SETTINGS_SECRET_KEY=.*|SETTINGS_SECRET_KEY=${KEY}|" "${CONF}"
  [ -n "${PORT_ARG}" ] && sed -i "s|^PORT=.*|PORT=${PORT_ARG}|" "${CONF}"
  echo "Created ${CONF} (random SETTINGS_SECRET_KEY)."
else
  echo "Keeping your existing ${CONF}."
  cp ppi-workbench.env "${CONF}.new-template"
  echo "The latest template is in ${CONF}.new-template if you want to compare."
fi
chown root:"${SVC_USER}" "${CONF}"
chmod 640 "${CONF}"
PORT="$(sed -n 's/^PORT=\([0-9]*\).*/\1/p' "${CONF}" | tail -1)"
PORT="${PORT:-4000}"

say "5/6 systemd service"
cp ppi-workbench.service /etc/systemd/system/ppi-workbench.service
systemctl daemon-reload
systemctl enable --now ppi-workbench

if [ "${FIREWALL}" = "1" ] && systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-port="${PORT}/tcp" >/dev/null
  firewall-cmd --reload >/dev/null
  echo "firewalld: opened ${PORT}/tcp"
fi

say "6/6 Checking that it answers"
OK=0
for _ in $(seq 1 20); do
  if "${PREFIX}/node/bin/node" -e "fetch('http://127.0.0.1:${PORT}/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then OK=1; break; fi
  sleep 1
done
if [ "${OK}" = "1" ]; then
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo
  echo "PPI & Swagger Workbench is running."
  echo "  Open:      http://${IP:-<server-ip>}:${PORT}"
  echo "  Settings:  ${CONF}  (then: systemctl restart ppi-workbench)"
  echo "  Logs:      journalctl -u ppi-workbench -f"
else
  echo "The service did not answer on port ${PORT}. Check:  journalctl -u ppi-workbench -n 50"
  exit 1
fi
