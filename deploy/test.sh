#!/usr/bin/env bash
set -euo pipefail
umask 022

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TARGET=/home/ubuntu/hydrodb/staging/test/hydrodb-empty-test/compose
export HYDRODB_FRONTEND_CONFIG_DIR="$ROOT/deploy"
export HYDRODB_FRONTEND_WEB_DIR="$ROOT/.local/test-web"

test -s "$ROOT/dist/index.html"
test -s "$TARGET/.env"
release="$(date -u +%Y%m%dT%H%M%S)-$$"
mkdir -p "$HYDRODB_FRONTEND_WEB_DIR/releases/$release"
cp -R "$ROOT/dist/." "$HYDRODB_FRONTEND_WEB_DIR/releases/$release/"
mkdir -p "$HYDRODB_FRONTEND_WEB_DIR/assets"
rsync -r --checksum "$ROOT/dist/assets/" "$HYDRODB_FRONTEND_WEB_DIR/assets/"

dc() {
    docker compose -p hydrodb-empty-test --project-directory "$TARGET" \
        -f "$TARGET/compose.yaml" -f "$TARGET/compose.test.yaml" \
        -f "$ROOT/deploy/compose.frontend.yaml" --env-file "$TARGET/.env" "$@"
}

dc run --rm --no-deps --entrypoint caddy ingress \
    validate --config /etc/caddy/Caddyfile --adapter caddyfile
ln -s "releases/$release" "$HYDRODB_FRONTEND_WEB_DIR/.current-$release"
mv -Tf "$HYDRODB_FRONTEND_WEB_DIR/.current-$release" "$HYDRODB_FRONTEND_WEB_DIR/current"
dc up -d --no-deps --force-recreate ingress

ca=/home/ubuntu/hydrodb/staging/test/hydrodb-empty-test/tls/ca.crt
curl --silent --show-error --fail --retry 10 --retry-delay 1 --retry-connrefused \
    --retry-all-errors --retry-max-time 30 \
    --cacert "$ca" https://hydrodb.test:18443/health/live
printf '\nPublished %s at https://hydrodb.test:18443/\n' "$release"
