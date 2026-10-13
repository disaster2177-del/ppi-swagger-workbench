#!/usr/bin/env bash
# =============================================================================
# Build the NO-DOCKER offline bundle. Run on a Linux x86_64 machine WITH
# internet access, Node.js 20+ and npm, from the repository root:
#
#     ./scripts/standalone/make-bundle.sh
#
# Result: dist-standalone/ppi-workbench-standalone-<version>-linux-x64.tar.gz
# It contains Node.js itself, the app with all its npm packages, the built
# web UI, a systemd service and install.sh. Nothing is downloaded on the
# target server.
#
# Options (environment variables):
#   NODE_VERSION=22.22.0   Node.js version to ship (22.x LTS; >= 22.21 for NODE_USE_ENV_PROXY)
#   NODE_ARCH=linux-x64    linux-arm64 for ARM servers
#   NPM_REGISTRY=https://nexus.local/repository/npm/   internal npm mirror
#   NODE_DIST=https://nodejs.org/dist                  internal Node.js mirror
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/../.."

NODE_VERSION="${NODE_VERSION:-22.22.0}"
NODE_ARCH="${NODE_ARCH:-linux-x64}"
NODE_DIST="${NODE_DIST:-https://nodejs.org/dist}"
VERSION="$(node -p "require('./package.json').version || 'latest'")"
NAME="ppi-workbench-standalone-${VERSION}-${NODE_ARCH}"
OUT="dist-standalone/${NAME}"
NPM_ARGS=(--no-audit --no-fund)
[ -n "${NPM_REGISTRY:-}" ] && NPM_ARGS+=(--registry "${NPM_REGISTRY}")

command -v node >/dev/null || { echo "Node.js is needed on this build machine."; exit 1; }
command -v curl >/dev/null || { echo "curl is needed on this build machine."; exit 1; }

rm -rf "${OUT}"
mkdir -p "${OUT}/app"

echo "==> 1/5 Installing all packages and building the web UI"
if [ -f package-lock.json ]; then npm ci "${NPM_ARGS[@]}"; else npm install "${NPM_ARGS[@]}"; fi
npm run build

echo "==> 2/5 Copying the app (server, shared code, built UI, example YAML)"
cp package.json "${OUT}/app/"
[ -f package-lock.json ] && cp package-lock.json "${OUT}/app/"
mkdir -p "${OUT}/app/client"
cp client/package.json "${OUT}/app/client/"
cp -r client/dist "${OUT}/app/client/dist"
cp -r shared samples "${OUT}/app/"
mkdir -p "${OUT}/app/server"
cp -r server/src server/scripts server/package.json "${OUT}/app/server/"
cp server/.env.example "${OUT}/app/server/"
rm -rf "${OUT}/app/shared/node_modules" "${OUT}/app/shared/test"

echo "==> 3/5 Installing runtime packages only (no build tools)"
( cd "${OUT}/app" && npm install --omit=dev "${NPM_ARGS[@]}" --workspace server --workspace shared )

echo "==> 4/5 Downloading Node.js ${NODE_VERSION} (${NODE_ARCH})"
NODE_TAR="node-v${NODE_VERSION}-${NODE_ARCH}.tar.xz"
curl -fSL "${NODE_DIST}/v${NODE_VERSION}/${NODE_TAR}" -o "${OUT}/${NODE_TAR}"
curl -fsSL "${NODE_DIST}/v${NODE_VERSION}/SHASUMS256.txt" | grep " ${NODE_TAR}\$" > "${OUT}/${NODE_TAR}.sha256"
( cd "${OUT}" && sha256sum -c "${NODE_TAR}.sha256" )

echo "==> 5/5 Adding installer, service, settings template and docs"
cp scripts/standalone/install.sh scripts/standalone/ppi-workbench.service scripts/standalone/ppi-workbench.env "${OUT}/"
chmod +x "${OUT}/install.sh"
mkdir -p "${OUT}/docs"
cp docs/RUN-WITHOUT-DOCKER.md "${OUT}/docs/"
echo "${NODE_VERSION}" > "${OUT}/NODE_VERSION"

tar -C dist-standalone -czf "dist-standalone/${NAME}.tar.gz" "${NAME}"
echo
echo "Done: dist-standalone/${NAME}.tar.gz ($(du -h "dist-standalone/${NAME}.tar.gz" | cut -f1))"
echo "Copy it to the RHEL server, then:  tar xzf ${NAME}.tar.gz && cd ${NAME} && sudo ./install.sh"
