#!/usr/bin/env bash
# Run on the dedicated Ubuntu 24.04 ARM host; owned partial installs can resume.
set -euo pipefail
umask 077
step() { printf '{"status":"bootstrap_step","step":"%s"}\n' "$1"; }
if [[ "$EUID" -ne 0 || "$(uname -m)" != "aarch64" ]]; then
  echo 'Run as root on the dedicated Ubuntu ARM VM.' >&2
  exit 1
fi
source /etc/os-release
if [[ "$ID" != ubuntu || "$VERSION_ID" != 24.04 ]]; then
  echo 'The reviewed bootstrap targets Ubuntu 24.04.' >&2
  exit 1
fi
marker=/etc/stacksignal/bootstrap-version
bootstrap_version='node24.19.0-openclaw2026.10.3-ollama0.40.4-caddy2.11.7-v2'
if [[ -e "$marker" && "$(cat "$marker")" != "$bootstrap_version" ]]; then
  echo 'Bootstrap version differs; an explicit upgrade review is required.' >&2
  exit 1
fi
if [[ ! -e "$marker" && ( -e /etc/stacksignal/bot.env || -e /var/lib/stacksignal-bot/openclaw/openclaw.json ) ]]; then
  echo 'Existing bot configuration detected; use the upgrade/recovery procedure.' >&2
  exit 1
fi
install -d -m 0750 /etc/stacksignal
printf '%s\n' "$bootstrap_version" > "$marker"
chmod 0600 "$marker"
systemctl stop stacksignal-bot stacksignal-openclaw caddy 2>/dev/null || true
source_root="$(cd "$(dirname "$0")/../.." && pwd)"
if [[ "$source_root" != /opt/stacksignal || ! -f "$source_root/bot/server.mjs" ]]; then
  echo 'Place the reviewed checkout at /opt/stacksignal first.' >&2
  exit 1
fi
step prerequisites
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl xz-utils zstd openssl git
download_dir="$(mktemp -d)"
trap 'rm -rf "$download_dir"' EXIT
download() {
  local url="$1" expected="$2" file="$3"
  curl --fail --location --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 900 "$url" -o "$file"
  printf '%s  %s\n' "$expected" "$file" | sha256sum --check --status
}
step node
download 'https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-arm64.tar.xz' \
  '01443c1e1a29e531ccad5a46fefa6df490d2189c49f7955904aecdbb0fe86fdc' "$download_dir/node.tar.xz"
umask 022  # Runtime binaries must be readable by the unprivileged service users.
install -d -m 0755 /opt/node
tar -xJf "$download_dir/node.tar.xz" --strip-components=1 -C /opt/node
# Debian package helpers (ldconfig/start-stop-daemon) and account utilities
# (useradd/runuser) live in sbin and are needed by this root bootstrap.
export PATH=/opt/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
step openclaw
npm_extra=()
npm_release="$(npm --version)"
IFS=. read -r npm_major npm_minor npm_patch <<< "$npm_release"
if (( npm_major >= 12 || (npm_major == 11 && npm_minor >= 16) )); then
  npm_extra+=(--allow-scripts=openclaw)
fi
# Public Git dependencies use HTTPS; no GitHub credentials are installed here.
export GIT_CONFIG_COUNT=2
export GIT_CONFIG_KEY_0=url.https://github.com/.insteadOf GIT_CONFIG_VALUE_0=ssh://git@github.com/
export GIT_CONFIG_KEY_1=url.https://github.com/.insteadOf GIT_CONFIG_VALUE_1=git@github.com:
npm install --global --prefix /opt/node --omit=dev --no-audit --no-fund "${npm_extra[@]}" openclaw@2026.10.3
step ollama
download 'https://github.com/ollama/ollama/releases/download/v0.40.4/ollama-linux-arm64.tar.zst' \
  '1a314ac530d2c23bf6d2aaaf4a4aba8cc0b2a4ee8bc8fae3f3aa88bff7f7177b' "$download_dir/ollama.tar.zst"
tar --zstd -xf "$download_dir/ollama.tar.zst" -C /usr/local
step caddy
download 'https://github.com/caddyserver/caddy/releases/download/v2.11.7/caddy_2.11.7_linux_arm64.deb' \
  'ca8ae5a50439642d7672344b4ec64e47cbddf81beb5da302420a78522eb5a47e' "$download_dir/caddy.deb"
DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=180 install -y --no-install-recommends "$download_dir/caddy.deb"
systemctl disable --now caddy
umask 077
step service_users
id stacksignal >/dev/null 2>&1 || useradd --system --user-group --home-dir /var/lib/stacksignal-bot --shell /usr/sbin/nologin stacksignal
id ollama >/dev/null 2>&1 || useradd --system --user-group --home-dir /var/lib/ollama --shell /usr/sbin/nologin ollama
install -d -o stacksignal -g stacksignal -m 0700 /var/lib/stacksignal-bot /var/lib/stacksignal-bot/openclaw \
  /var/lib/stacksignal-bot/.cache /var/lib/stacksignal-bot/.npm
install -d -o root -g stacksignal -m 0750 /etc/stacksignal
install -d -o ollama -g ollama -m 0700 /var/lib/ollama
install -m 0644 "$source_root/bot/deploy/ollama.service" /etc/systemd/system/ollama.service
install -m 0644 "$source_root/bot/deploy/stacksignal-bot.service" /etc/systemd/system/stacksignal-bot.service
install -m 0644 "$source_root/bot/deploy/stacksignal-openclaw.service" /etc/systemd/system/stacksignal-openclaw.service
if [[ ! -e /etc/stacksignal/bot.env ]]; then
  install -o root -g stacksignal -m 0640 "$source_root/bot/deploy/bot.env.example" /etc/stacksignal/bot.env
fi
run_bot() (
  cd /var/lib/stacksignal-bot
  runuser -u stacksignal -- env PATH="$PATH" HOME=/var/lib/stacksignal-bot \
    XDG_CACHE_HOME=/var/lib/stacksignal-bot/.cache npm_config_cache=/var/lib/stacksignal-bot/.npm \
    OPENCLAW_STATE_DIR=/var/lib/stacksignal-bot/openclaw \
    OPENCLAW_CONFIG_PATH=/var/lib/stacksignal-bot/openclaw/openclaw.json "$@"
)
if [[ ! -e /var/lib/stacksignal-bot/openclaw/openclaw.json ]]; then
  run_bot node "$source_root/bot/deploy/render-openclaw-config.mjs" --core-only
fi
step whatsapp_plugin
if ! run_bot node -e 'const c=JSON.parse(require("fs").readFileSync(process.env.OPENCLAW_CONFIG_PATH));process.exit(c.plugins?.installs?.whatsapp ? 0:1)'; then
  run_bot openclaw plugins install npm:@openclaw/whatsapp@2026.10.3 --pin
fi
if ! run_bot node -e 'const c=JSON.parse(require("fs").readFileSync(process.env.OPENCLAW_CONFIG_PATH));process.exit(c.channels?.whatsapp ? 0:1)'; then
  run_bot node "$source_root/bot/deploy/render-openclaw-config.mjs" --finalize-plugin-install
fi
step config_validation
run_bot openclaw config validate --json
systemctl daemon-reload
systemctl enable --now ollama
# Fixed local model, no credentials for Gemini or any other inference service.
step model_pull
OLLAMA_HOST=127.0.0.1:11434 ollama pull qwen3:4b
install -o ollama -g ollama -m 0600 /dev/null /var/lib/ollama/model-manifest.json
curl --fail --silent --max-time 30 http://127.0.0.1:11434/api/tags > /var/lib/ollama/model-manifest.json
printf '%s\n' 'complete' > /etc/stacksignal/bootstrap-complete
step complete
echo 'Local runtime prepared. Alerts remain off until QR pairing and destination verification.'
