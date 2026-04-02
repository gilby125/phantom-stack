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

    console.log(`[slack] message ${threadId}: ${text.slice(0, 80)}`);

    await bridge.handleMessage(
      'slack',
      threadId,
      text,
      async (reply) => { await say({ text: reply, thread_ts: threadId }); }
    );
  });

  app.event('app_mention', async ({ event, say }) => {
    const threadId: string = event.thread_ts ?? event.ts;
    const text: string = event.text ?? '';
    if (!text.trim()) return;

    console.log(`[slack] mention ${threadId}: ${text.slice(0, 80)}`);

    // Strip the bot mention from the text
    const cleanText = text.replace(/<@[A-Z0-9]+>/g, '').trim();

    await bridge.handleMessage(
      'slack',
      threadId,
      cleanText,
      async (reply) => { await say({ text: reply, thread_ts: threadId }); }
    );
  });

  app.start().then(() => console.log('[slack] Socket Mode active'));
  return app;
}
