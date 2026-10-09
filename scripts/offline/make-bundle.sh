#!/usr/bin/env bash
# =============================================================================
# Build the OFFLINE BUNDLE.  Run this on a machine WITH internet access
# (Linux x86_64, or any machine with Docker buildx), from the repository root:
#
#     ./scripts/offline/make-bundle.sh
#
# Result: dist-offline/ppi-workbench-offline-<version>.tar.gz
# Copy that single file to the offline RHEL server and run install.sh in it.
#
# Options (environment variables):
#   VERSION=2.0.1          tag for the app image (default: version in package.json)
#   PLATFORM=linux/amd64   CPU architecture of the RHEL server (linux/arm64 for ARM)
#   WITH_KAFKA_UI=1        also include the Kafka UI image (optional tool)
#   NPM_REGISTRY=https://nexus.local/repository/npm/   use an internal npm mirror
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/../.."

VERSION="${VERSION:-$(sed -n 's/^  "version": "\(.*\)",$/\1/p' package.json | head -1)}"
VERSION="${VERSION:-latest}"
PLATFORM="${PLATFORM:-linux/amd64}"
APP_IMAGE="ppi-workbench:${VERSION}"
THIRD_PARTY=("mongo:7.0" "apache/kafka:3.9.0")
[ "${WITH_KAFKA_UI:-0}" = "1" ] && THIRD_PARTY+=("provectuslabs/kafka-ui:v0.7.2")

NAME="ppi-workbench-offline-${VERSION}"
OUT="dist-offline/${NAME}"
rm -rf "${OUT}"
mkdir -p "${OUT}"

echo "==> 1/4 Building ${APP_IMAGE} for ${PLATFORM} (downloads npm packages)"
docker build --platform "${PLATFORM}" \
  --build-arg NPM_REGISTRY="${NPM_REGISTRY:-}" \
  -t "${APP_IMAGE}" .

echo "==> 2/4 Pulling third-party images"
for img in "${THIRD_PARTY[@]}"; do
  docker pull --platform "${PLATFORM}" "${img}"
done

echo "==> 3/4 Saving images (this can take a few minutes)"
docker save "${APP_IMAGE}" "${THIRD_PARTY[@]}" | gzip -1 > "${OUT}/images.tar.gz"

echo "==> 4/4 Adding compose file, settings template, installer and docs"
# The offline server never builds: drop the build section from the compose file.
awk '
  /^    build:/ { skip=1; next }
  skip && /^      / { next }
  { skip=0; print }
' docker-compose.yml > "${OUT}/docker-compose.yml"
cp .env.example "${OUT}/.env.example"
sed -i "s/^APP_VERSION=.*/APP_VERSION=${VERSION}/" "${OUT}/.env.example"
cp scripts/offline/install.sh "${OUT}/install.sh"
chmod +x "${OUT}/install.sh"
mkdir -p "${OUT}/docs"
cp docs/OFFLINE-RHEL.md docs/DEPLOY.md "${OUT}/docs/"
printf '%s\n' "${APP_IMAGE}" "${THIRD_PARTY[@]}" > "${OUT}/IMAGES.txt"
( cd "${OUT}" && sha256sum images.tar.gz > images.tar.gz.sha256 )

tar -C dist-offline -czf "dist-offline/${NAME}.tar.gz" "${NAME}"
echo
echo "Done: dist-offline/${NAME}.tar.gz ($(du -h "dist-offline/${NAME}.tar.gz" | cut -f1))"
echo "Copy it to the RHEL server, then:  tar xzf ${NAME}.tar.gz && cd ${NAME} && ./install.sh"
