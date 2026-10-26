#!/usr/bin/env bash
# Invoked by a VM-local systemd timer. No SSH listener, VPN client, or GitHub runner.
set -euo pipefail
umask 077

: "${APP_DIR:?Set APP_DIR in /etc/utcn-timetable-deploy.env}"
: "${COMPOSE_PROJECT_NAME:?Set the existing Compose project name}"
IMAGE_REPOSITORY=${IMAGE_REPOSITORY:-ghcr.io/airi-utcn/timetable-utcn}
STATE_DIR=${STATE_DIR:-/var/lib/utcn-timetable-deploy}
DEPLOY_WAIT_SECONDS=${DEPLOY_WAIT_SECONDS:-180}
MIN_FREE_MB=${MIN_FREE_MB:-5120}

log() { printf '%s\n' "$*"; }
fail() { log "$*" >&2; exit 1; }

[[ "$IMAGE_REPOSITORY" =~ ^ghcr\.io/[a-z0-9._/-]+$ ]] || fail 'Invalid GHCR repository.'
[[ "$COMPOSE_PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail 'Invalid Compose project name.'
[[ "$DEPLOY_WAIT_SECONDS" =~ ^[0-9]+$ && "$MIN_FREE_MB" =~ ^[0-9]+$ ]] || fail 'Invalid numeric setting.'
[[ -f "$APP_DIR/.env" && -f "$APP_DIR/docker-compose.vm.yml" && -f "$APP_DIR/docker-compose.yml" ]] || fail 'Missing application configuration.'

mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/deploy.lock"
flock -n 9 || exit 0

compose() {
    docker compose --project-directory "$APP_DIR" --env-file "$APP_DIR/.env" \
        --project-name "$COMPOSE_PROJECT_NAME" \
        -f "$APP_DIR/docker-compose.yml" -f "$APP_DIR/docker-compose.vm.yml" "$@"
}

write_state() {
    local temporary
    temporary=$(mktemp "$STATE_DIR/.state.XXXXXX")
    printf '%s\n' "$2" > "$temporary"
    mv "$temporary" "$STATE_DIR/$1"
}

export TIMETABLE_IMAGE="$IMAGE_REPOSITORY:production"
compose config --quiet
docker_root=$(docker info --format '{{.DockerRootDir}}')
free_mb=$(df -Pm "$docker_root" | awk 'NR == 2 { print $4 }')
[[ "$free_mb" =~ ^[0-9]+$ ]] || fail 'Could not determine Docker disk space.'
(( free_mb >= MIN_FREE_MB )) || fail 'Not enough free disk space; current container was left running.'

# Pull first. A registry/network/build failure never stops the running service.
docker pull "$TIMETABLE_IMAGE"
desired_id=$(docker image inspect "$TIMETABLE_IMAGE" --format '{{.Id}}')
desired_ref=$(docker image inspect "$TIMETABLE_IMAGE" --format '{{json .RepoDigests}}' | \
    python3 -c 'import json,sys; repository=sys.argv[1]; refs=[ref for ref in json.load(sys.stdin) if ref.startswith(repository+"@sha256:")]; assert refs; print(refs[0])' "$IMAGE_REPOSITORY")

if [[ -f "$STATE_DIR/failed-image" && -f "$STATE_DIR/failed-at" ]]; then
    failed_at=$(cat "$STATE_DIR/failed-at")
    if [[ "$(cat "$STATE_DIR/failed-image")" == "$desired_ref" && "$failed_at" =~ ^[0-9]+$ ]] && \
        (( $(date +%s) - failed_at < 1800 )); then
        log 'This image recently failed; retry deferred for 30 minutes.'
        exit 0
    fi
fi

current_id=$(docker inspect utcn-timetable --format '{{.Image}}' 2>/dev/null || true)
health=$(docker inspect utcn-timetable --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>/dev/null || true)
if [[ "$current_id" == "$desired_id" && "$health" == healthy ]]; then
    write_state current-image "$desired_ref"
    log 'The current production image is already healthy.'
    exit 0
fi

if [[ -n "$current_id" ]]; then
    # Refuse accidental migration to new empty volumes if a project name is wrong.
    current_project=$(docker inspect utcn-timetable --format '{{index .Config.Labels "com.docker.compose.project"}}')
    [[ "$current_project" == "$COMPOSE_PROJECT_NAME" ]] || fail 'Compose project mismatch; refusing to change existing volumes.'
    [[ "$current_id" =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'Invalid current image ID.'
    write_state previous-image "$current_id"
    docker image tag "$current_id" utcn-timetable-rollback:previous
    # Online SQLite backup and inventory snapshot before replacing the container.
    docker exec --user appuser utcn-timetable python -c '
import pathlib, shutil, sqlite3, sys
root = pathlib.Path("/app/data/deploy-backups")
root.mkdir(mode=0o700, parents=True, exist_ok=True)
target = root / sys.argv[1]
target.mkdir(mode=0o700)
database = pathlib.Path("/app/data/app.db")
if database.exists():
    with sqlite3.connect(str(database)) as source, sqlite3.connect(str(target / "app.db")) as destination:
        source.backup(destination)
shutil.copytree("/app/config", target / "config", symlinks=True)
for old in sorted(root.glob("release-*"))[:-7]:
    if old.is_dir() and not old.is_symlink():
        shutil.rmtree(old)
' "release-$(date -u +%Y%m%dT%H%M%S)-$$"
fi

export TIMETABLE_IMAGE="$desired_ref"
if compose up --no-build --no-deps --pull never --force-recreate --wait --wait-timeout "$DEPLOY_WAIT_SECONDS" timetable; then
    write_state current-image "$desired_ref"
    rm -f "$STATE_DIR/failed-image" "$STATE_DIR/failed-at"
    log "Deployment healthy: $desired_ref"
    exit 0
fi

write_state failed-image "$desired_ref"
write_state failed-at "$(date +%s)"
if [[ -n "$current_id" ]]; then
    log 'New image failed health checks; restoring the previous image.'
    export TIMETABLE_IMAGE=utcn-timetable-rollback:previous
    if ! compose up --no-build --no-deps --pull never --force-recreate --wait --wait-timeout "$DEPLOY_WAIT_SECONDS" timetable; then
        fail 'Rollback also failed. Inspect the service and deployment journal.'
    fi
fi
fail 'Deployment failed; no successful release was recorded.'
