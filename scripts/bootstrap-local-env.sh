#!/usr/bin/env bash
set -euo pipefail

stack_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$stack_dir/.env"

if [[ -f "$env_file" && "${1:-}" != "--force" ]]; then
  echo "$env_file already exists. Re-run with --force to replace it." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to generate SANDBOXED_JWT" >&2
  exit 1
fi

password="$(openssl rand -base64 24 | tr -d '\n' | tr '/+' '_-' | cut -c1-24)"
secret="$(openssl rand -hex 32)"
token="$(node - "$secret" <<'NODE'
const crypto = require('node:crypto');
const secret = process.argv[2];
const now = Math.floor(Date.now() / 1000);
const exp = now + 30 * 24 * 60 * 60;
const header = { alg: 'HS256', typ: 'JWT' };
const payload = { sub: 'default', usr: 'default', iat: now, exp };
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const unsigned = `${encode(header)}.${encode(payload)}`;
const sig = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
process.stdout.write(`${unsigned}.${sig}`);
NODE
)"

cat > "$env_file" <<ENV
SANDBOXED_DASHBOARD_PASSWORD=$password
SANDBOXED_JWT_SECRET=$secret
SANDBOXED_JWT=$token
SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=
LIBRARY_REPO_URL=https://github.com/gilby125/phantom-library.git
EVOLUTION_USE_LLM_JUDGES=0
ANTHROPIC_API_KEY=
MEMORY_MCP_HTTP_PORT=3333
ENV

echo "Wrote $env_file"
echo "Fill in Slack tokens if needed, then run: docker compose up -d --build"
