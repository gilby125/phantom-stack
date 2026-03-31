import { SandboxedClient, type SandboxedEvent } from './client.js';
import { ThreadMap } from './thread-map.js';

export type ReplyFn = (text: string) => Promise<void>;

export class RelayBridge {
  private stopStream?: () => void;

  constructor(
    private client: SandboxedClient,
    private map: ThreadMap,
    private backend: string = 'opencode'
  ) {}

  /**
   * Call this when a message arrives from any channel.
   * Returns the missionId so the caller can subscribe to replies.
   */
  async handleMessage(
    channel: string,
    threadId: string,
    text: string,
    onReply: ReplyFn,
    onThinking?: (text: string) => Promise<void>
  ): Promise<string> {
    // Look up or create a mission for this thread
    let missionId = await this.map.get(channel, threadId);
    if (!missionId) {
      missionId = await this.client.createMission(`[${channel}] ${text.slice(0, 60)}`, this.backend);
      await this.map.set(channel, threadId, missionId);
    }

    // Load the mission into the active control session
    await this.client.loadMission(missionId);

    // Subscribe to the SSE stream BEFORE sending the message
    // so we don't miss any events
    this.stopStream?.(); // stop previous stream if any
    this.stopStream = this.client.streamEvents(async (evt: SandboxedEvent) => {
      if (evt.event === 'assistant_message') {
        const content: string = evt.data?.content ?? JSON.stringify(evt.data);
        await onReply(content);
        this.stopStream?.();
        this.stopStream = undefined;
      } else if (evt.event === 'thinking' && onThinking) {
        await onThinking(evt.data?.content ?? '');
      } else if (evt.event === 'error') {
        await onReply(`⚠️ Agent error: ${evt.data?.message ?? 'unknown'}`);
      }
    });

    // Send the user message
    await this.client.sendMessage(text);

    return missionId;
  }

  destroy(): void {
    this.stopStream?.();
  }
}
