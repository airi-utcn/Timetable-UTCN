#!/usr/bin/env bash
# Run manually, once, from a checkout on the VM. Does not connect to the VM.
set -euo pipefail
umask 077

[[ "$(id -u)" == 0 ]] || { echo 'Run this installer with sudo on the VM.' >&2; exit 1; }
APP_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
for command in docker flock python3 systemctl; do
    command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 1; }
done
docker compose up --help | grep -q -- '--wait-timeout' || { echo 'Install a current Docker Compose v2 plugin.' >&2; exit 1; }
[[ -f "$APP_DIR/.env" ]] || { echo 'Configure .env with strong credentials before installation.' >&2; exit 1; }

project=$(docker inspect utcn-timetable --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true)
project=${COMPOSE_PROJECT_NAME:-$project}
[[ "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo 'Set COMPOSE_PROJECT_NAME to the existing Docker Compose project.' >&2; exit 1; }

install -m 755 "$APP_DIR/deployment/pull-deploy.sh" /usr/local/sbin/utcn-timetable-pull-deploy
install -m 644 "$APP_DIR/deployment/utcn-timetable-deploy.service" /etc/systemd/system/
install -m 644 "$APP_DIR/deployment/utcn-timetable-deploy.timer" /etc/systemd/system/
if [[ ! -f /etc/utcn-timetable-deploy.env ]]; then
    python3 - "$APP_DIR" "$project" > /etc/utcn-timetable-deploy.env <<'PY'
import json, sys
print('APP_DIR=' + json.dumps(sys.argv[1]))
print('COMPOSE_PROJECT_NAME=' + json.dumps(sys.argv[2]))
print('IMAGE_REPOSITORY=ghcr.io/airi-utcn/timetable-utcn')
PY
    chmod 600 /etc/utcn-timetable-deploy.env
fi
systemctl daemon-reload
echo 'Installed, but the timer is not enabled yet.'
echo 'After configuring package access and checking .env, activate with:'
echo '  sudo systemctl enable --now utcn-timetable-deploy.timer'
