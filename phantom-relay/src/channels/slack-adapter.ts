import { App } from '@slack/bolt';
import { RelayBridge } from '../bridge/relay.js';

export function startSlack(bridge: RelayBridge) {
  const app = new App({
    token: process.env.SLACK_BOT_TOKEN!,
    appToken: process.env.SLACK_APP_TOKEN!,
    socketMode: true,
  });

  app.message(async ({ message, say }) => {
    const msg = message as any;
    const threadId: string = msg.thread_ts ?? msg.ts;
    const text: string = msg.text ?? '';
    if (!text.trim()) return;

    console.log(`[slack] ${threadId}: ${text.slice(0, 80)}`);

    await bridge.handleMessage(
      'slack',
      threadId,
      text,
      async (reply) => { await say({ text: reply, thread_ts: threadId }); }
    );
  });

  app.start().then(() => console.log('[slack] Socket Mode active'));
  return app;
}
