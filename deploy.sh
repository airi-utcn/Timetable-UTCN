#!/usr/bin/env bash
# deploy.sh - Comprehensive deployment script for the UTCN timetable app
# What it does:
#   - verifies prerequisites (git, docker, docker compose, curl)
#   - pulls latest code, ensures .env exists, rebuilds images, starts stack
#   - optionally prunes, runs full extraction or worker-once
#   - waits for health and prints status/logs
# Usage: ./deploy.sh

set -euo pipefail

# ---------- helpers ----------
color() { local c="$1"; shift; printf "\033[%sm%s\033[0m" "$c" "$*"; }
info()  { printf "%s %s\n" "$(color 1; color 34 "[INFO]")" "$*"; }
warn()  { printf "%s %s\n" "$(color 1; color 33 "[WARN]")" "$*"; }
err()   { printf "%s %s\n" "$(color 1; color 31 "[ERROR]")" "$*"; }
die()   { err "$*"; exit 1; }

require_cmd() {
	command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

# docker compose shim: prefer `docker compose`, fall back to docker-compose
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
	DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
	DC=(docker-compose)
else
	die "docker compose not found; install Docker with Compose V2"
fi

require_cmd git
require_cmd docker
require_cmd curl
require_cmd sed

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

info "=== UTCN Timetable Full Deploy ==="

# Configurable flags (export or edit if you want to change defaults)
DO_PRUNE=${DO_PRUNE:-false}                 # set true to prune unused images
# By default do NOT run the long Playwright full extraction during deploy since
# it can take a long time for many calendars. Use the systemd timer (below)
# to run imports hourly in background. You can still force a one-off run by
# exporting RUN_FULL_EXTRACTION=true when invoking this script.
RUN_FULL_EXTRACTION=${RUN_FULL_EXTRACTION:-false}
RUN_WORKER_ONCE=${RUN_WORKER_ONCE:-false}
INSTALL_SYSTEMD_TIMER=${INSTALL_SYSTEMD_TIMER:-false} # set true to install systemd timer (must run as root)
WAIT_FOR_HEALTH=${WAIT_FOR_HEALTH:-true}
HEALTH_WAIT_SECONDS=${HEALTH_WAIT_SECONDS:-60}
RUN_LOCAL_ADMIN_TEST=${RUN_LOCAL_ADMIN_TEST:-true}

echo "📥 Pulling latest code from git..."
git pull origin main

if ! git diff --quiet || ! git diff --cached --quiet; then
	warn "Git working tree is dirty; consider committing or stashing local changes before deploy"
fi

if [ ! -f .env ] && [ -f .env.example ]; then
	warn ".env not found; copying from .env.example"
	cp .env.example .env
	warn "Copied .env.example -> .env. Edit .env to configure ADMIN_PASSWORD, PLAYWRIGHT creds, and secrets as needed"
fi

# Ensure some critical env values exist and are reasonably secure for local deploy.
# We source the .env in a safe/exporting way, generate FLASK_SECRET if missing,
# and warn if ADMIN_PASSWORD is the default.
if [ -f .env ]; then
	# export variables from .env to access them in this script (simple, not for production secret management)
	set -a
	# shellcheck disable=SC1091
	. ./.env || true
	set +a

	# Generate a FLASK_SECRET if not set
	if [ -z "${FLASK_SECRET:-}" ]; then
		info "Generating a random FLASK_SECRET and appending to .env"
		# 32 bytes hex = 64 chars
		FLASK_SECRET_VAL=$(openssl rand -hex 32 2>/dev/null || python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
)
		printf "\nFLASK_SECRET=%s\n" "$FLASK_SECRET_VAL" >> .env
		export FLASK_SECRET="$FLASK_SECRET_VAL"
	fi

	# Ensure ADMIN_USERNAME/ADMIN_PASSWORD exist in .env; if not, append defaults from example
	if [ -z "${ADMIN_USERNAME:-}" ]; then
		info "ADMIN_USERNAME missing in .env; defaulting to 'admin' (edit .env to change)"
		printf "\nADMIN_USERNAME=admin\n" >> .env
		export ADMIN_USERNAME=admin
	fi
	if [ -z "${ADMIN_PASSWORD:-}" ]; then
		warn "ADMIN_PASSWORD missing in .env; defaulting to 'admin123' (edit .env to change)"
		printf "\nADMIN_PASSWORD=admin123\n" >> .env
		export ADMIN_PASSWORD=admin123
	fi

	# Warn if using weak default password
	if [ "${ADMIN_PASSWORD}" = "admin123" ]; then
		warn "Using default ADMIN_PASSWORD 'admin123' — consider setting a stronger password in .env"
	fi
fi

echo "🔧 Stopping existing containers (preserve volumes)..."
"${DC[@]}" down --remove-orphans || true

if [ "$DO_PRUNE" = "true" ]; then
	echo "🧹 Pruning unused images and containers..."
	docker system prune -f || true
fi

echo "🔨 Building Docker images (parallel, with BuildKit)..."
DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 "${DC[@]}" build --parallel

echo "🚀 Starting containers..."
"${DC[@]}" up -d

if [ "$WAIT_FOR_HEALTH" = "true" ]; then
	echo "⏳ Waiting up to ${HEALTH_WAIT_SECONDS}s for app health (http://localhost:5000/health)"
	elapsed=0
	until curl -sSf http://localhost:5000/health >/dev/null 2>&1 || [ $elapsed -ge $HEALTH_WAIT_SECONDS ]; do
		sleep 2
		elapsed=$((elapsed+2))
		printf '.'
	done
	if curl -sSf http://localhost:5000/health >/dev/null 2>&1; then
		echo "\n✅ App is healthy"
	else
		echo "\n⚠️ App did not report healthy within ${HEALTH_WAIT_SECONDS}s; check logs"
	fi
fi

# Optional: test local admin form login using credentials in .env (useful to verify
# the app received ADMIN_USERNAME/ADMIN_PASSWORD correctly into the container).
if [ "${RUN_LOCAL_ADMIN_TEST}" = "true" ]; then
	info "Running local admin form-login test (http://localhost:5000/admin)"
	# Load environment values from .env (if present)
	if [ -f .env ]; then
		set -a
		# shellcheck disable=SC1091
		. ./.env || true
		set +a
	fi

	# Prepare temp files
	ADMIN_TEST_DIR=$(mktemp -d 2>/dev/null || echo /tmp)
	ADMIN_GET_HTML="$ADMIN_TEST_DIR/admin_get.html"
	ADMIN_LOGIN_HTML="$ADMIN_TEST_DIR/admin_login.html"
	COOKIES_FILE="$ADMIN_TEST_DIR/admin_cookies.txt"

	# Do GET to extract CSRF token and initial session cookie
	curl -s -c "$COOKIES_FILE" "http://localhost:5000/admin" -o "$ADMIN_GET_HTML" || true
	csrf_token=$(grep -oP 'name="csrf_token" value="\K[^"]+' "$ADMIN_GET_HTML" || true)
	if [ -z "$csrf_token" ]; then
		warn "Could not extract CSRF token from /admin; check app logs"
	else
		# Perform POST with credentials
		USERNAME_VAL="${ADMIN_USERNAME:-admin}"
		PASSWORD_VAL="${ADMIN_PASSWORD:-admin123}"
		curl -s -b "$COOKIES_FILE" -c "$COOKIES_FILE" -i -L -X POST 'http://localhost:5000/admin/login' \
			--data-urlencode "username=${USERNAME_VAL}" \
			--data-urlencode "password=${PASSWORD_VAL}" \
			--data-urlencode "csrf_token=${csrf_token}" \
			-H 'Referer: http://localhost:5000/admin' \
			-A 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' \
			-o "$ADMIN_LOGIN_HTML" || true

		# Inspect login result
		if grep -q -i "Invalid credentials" "$ADMIN_LOGIN_HTML" || grep -q -i "Invalid CSRF" "$ADMIN_LOGIN_HTML"; then
			err "Local admin login test failed: server returned invalid credentials / CSRF message. Check .env and container logs."
			echo "---- login response head ----"
			head -n 80 "$ADMIN_LOGIN_HTML" || true
			echo "---- end response ----"
		else
			info "Local admin form-login appears successful (login POST accepted)."
		fi
	fi
	# cleanup
	rm -rf "$ADMIN_TEST_DIR" || true
fi

# Run the long-running full extraction (populate per-calendar files) inside container
if [ "$RUN_FULL_EXTRACTION" = "true" ]; then
	echo "🔁 Running full extraction for all enabled calendars (this may take long)..."
	# Run inside the timetable service container so environment and Playwright are available
	"${DC[@]}" exec -T timetable sh -c 'export PYTHONUTF8=1; python3 tools/run_full_extraction.py'
	echo "✅ Full extraction finished (check playwright_captures/*.json)"
fi

# Run the worker once to merge future events/preserved past and rebuild schedule.
# NOTE: The entrypoint.sh already starts a detached full extraction on container
# start. Running the worker immediately here would find zero events (extraction
# hasn't finished yet) and produce a "No events found" message. We now default
# RUN_WORKER_ONCE=false to avoid this. If you need a one-off worker run, wait
# for the extraction to finish first, then manually run:
#   docker compose exec timetable python3 tools/worker_update_future.py
if [ "$RUN_WORKER_ONCE" = "true" ]; then
	echo "🔧 Running worker once (merge future events, rebuild schedule)..."
	"${DC[@]}" exec -T timetable sh -c 'export PYTHONUTF8=1; RUN_ONCE=1 python3 tools/worker_update_future.py'
	echo "✅ Worker RUN_ONCE finished"
fi

echo ""
echo "📦 Docker compose status:"
"${DC[@]}" ps

echo ""
echo "📄 Last schedule file info (playwright_captures/schedule_by_room.json):"
"${DC[@]}" exec -T timetable sh -c 'ls -lh playwright_captures/schedule_by_room.json || true'

echo ""
echo "📋 Tail of application logs (last 200 lines):"
"${DC[@]}" logs --no-color --tail=200

echo ""
echo "✅ Deployment script finished. Visit: http://localhost:5000/"
echo "Admin panel (legacy/React): http://localhost:5000/admin (protected by ADMIN_PASSWORD)"
echo "" 

if [ "$INSTALL_SYSTEMD_TIMER" = "true" ]; then
	echo "\n🕒 Installing systemd service + timer to run imports hourly (requires root)"
	if [ "$(id -u)" -ne 0 ]; then
		echo "⚠️ Not running as root. Please run this script as root to install the timer, or run the commands printed below manually."
		echo "To install manually, run as root the unit files shown in the repository or re-run deploy.sh as root with INSTALL_SYSTEMD_TIMER=true"
	else
		SERVICE_PATH=/etc/systemd/system/utcn-timetable-import.service
		TIMER_PATH=/etc/systemd/system/utcn-timetable-import.timer
		echo "Writing $SERVICE_PATH and $TIMER_PATH"
		cat > "$SERVICE_PATH" <<'UNIT'
[Unit]
Description=UTCN Timetable Playwright full import (one-shot)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
WorkingDirectory=%ROOT_DIR%
ExecStart=/usr/bin/env bash -c 'flock -n /tmp/utcn_timetable_import.lock docker compose exec -T timetable sh -c "export PYTHONUTF8=1; python3 tools/run_full_extraction.py"'
User=root

[Install]
WantedBy=multi-user.target
UNIT

		cat > "$TIMER_PATH" <<'TIMER'
[Unit]
Description=Run UTCN Timetable full import hourly

[Timer]
OnBootSec=5min
OnUnitActiveSec=1h
Persistent=true

[Install]
WantedBy=timers.target
TIMER

		# Replace %ROOT_DIR% with the actual path of the repo root
		sed -i.bak "s|%ROOT_DIR%|${ROOT_DIR}|g" "$SERVICE_PATH"

		systemctl daemon-reload
		systemctl enable --now utcn-timetable-import.timer
		echo "✅ systemd timer installed and started (utcn-timetable-import.timer). Use 'journalctl -u utcn-timetable-import.service' to see logs."
	fi
fi
