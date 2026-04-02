import axios from 'axios';
import { EventSource } from 'eventsource';

export interface SandboxedEvent {
  event: string;
  data: any;
}

export class SandboxedClient {
  private baseUrl: string;

  constructor(base: string, private jwt: string) {
    this.baseUrl = base.replace(/\/$/, '');
  }

  private get h() {
    return { Authorization: `Bearer ${this.jwt}`, 'Content-Type': 'application/json' };
  }

  async createMission(title: string, backend?: string): Promise<string> {
    const res = await axios.post(`${this.baseUrl}/api/control/missions`, { title, backend }, { headers: this.h });
    return res.data.id as string;
  }

  async loadMission(missionId: string): Promise<void> {
    await axios.post(`${this.baseUrl}/api/control/missions/${missionId}/load`, {}, { headers: this.h });
  }

  async sendMessage(content: string): Promise<void> {
    await axios.post(`${this.baseUrl}/api/control/message`, { content }, { headers: this.h });
  }

  streamEvents(onEvent: (e: SandboxedEvent) => void, onError?: (e: any) => void): () => void {
    const es = new EventSource(`${this.baseUrl}/api/control/stream`, {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          headers: {
            ...(init?.headers ?? {}),
            ...this.h,
          },
        }),
    });
    const types = ['status', 'assistant_message', 'thinking', 'tool_call', 'tool_result', 'error'];
    types.forEach(type => {
      es.addEventListener(type, (e: any) => {
        try { onEvent({ event: type, data: JSON.parse(e.data) }); }
        catch { /* ignore parse errors */ }
      });
    });
    if (onError) es.onerror = onError;
    return () => es.close();
  }
}
