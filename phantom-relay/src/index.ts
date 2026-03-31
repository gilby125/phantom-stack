import { SandboxedClient } from './bridge/client.js';
import { ThreadMap } from './bridge/thread-map.js';
import { RelayBridge } from './bridge/relay.js';
import { startSlack } from './channels/slack-adapter.js';

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

async function main() {
  const client = new SandboxedClient(
    normalizeSandboxedUrl(process.env.SANDBOXED_URL || 'http://localhost:3000'),
    process.env.SANDBOXED_JWT || 'dev'
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
}

main().catch((e) => { console.error(e); process.exit(1); });
