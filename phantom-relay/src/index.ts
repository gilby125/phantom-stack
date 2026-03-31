import { SandboxedClient } from './bridge/client.js';
import { ThreadMap } from './bridge/thread-map.js';
import { RelayBridge } from './bridge/relay.js';
import { startSlack } from './channels/slack-adapter.js';
import { createHmac } from 'node:crypto';

function normalizeSandboxedUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, '');
  try {
    const url = new URL(trimmed);
    if (url.hostname === 'sandboxed' && url.port === '3000') {
      return url.origin;
    }
  } catch {
    // Keep original (a later request will error with a clearer message).
  }
  return trimmed;
}

function mintServiceJwt(secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 30 * 24 * 60 * 60;
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { sub: 'default', usr: 'default', iat: now, exp };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode(header)}.${encode(payload)}`;
  const sig = createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${sig}`;
}

function normalizeToken(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const inner = trimmed.slice(1, -1).trim();
    return inner || undefined;
  }
  return trimmed;
}

async function main() {
  const secret = process.env.SANDBOXED_JWT_SECRET?.trim();
  const token = normalizeToken(process.env.SANDBOXED_JWT) || (secret ? mintServiceJwt(secret) : 'dev');
  const client = new SandboxedClient(
    normalizeSandboxedUrl(process.env.SANDBOXED_URL || 'http://localhost:3000'),
    token
  );

  const map = new ThreadMap();
  await map.init('./thread-map.sqlite');

  const bridge = new RelayBridge(client, map, process.env.SANDBOXED_BACKEND || 'opencode');

  if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN) {
    startSlack(bridge);
  } else {
    console.warn('[relay] SLACK_BOT_TOKEN / SLACK_APP_TOKEN not set — Slack disabled');
  }

  console.log('[phantom-relay] Started.');
  await new Promise<void>(() => {});
}

main().catch((e) => { console.error(e); process.exit(1); });
