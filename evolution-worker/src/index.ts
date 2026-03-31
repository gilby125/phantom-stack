import axios from 'axios';
import { EventSource } from 'eventsource';
import { join } from 'node:path';
import { EvolutionEngine } from './evolution/engine.js';
import { EvolutionConfigSchema, type EvolutionConfig } from './evolution/config.js';
import type { SessionSummary } from './evolution/types.js';
import { GitLibrary } from './git/repo.js';

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

const SANDBOXED_URL = normalizeSandboxedUrl(process.env.SANDBOXED_URL || 'http://localhost:3000');
const SANDBOXED_JWT = process.env.SANDBOXED_JWT || 'dev';
const LIBRARY_REPO = process.env.LIBRARY_REPO_URL;

if (!LIBRARY_REPO) {
  console.error('FATAL: LIBRARY_REPO_URL is required to clone and push evolution updates.');
  process.exit(1);
}

const git = new GitLibrary(LIBRARY_REPO);

function buildEvolutionConfig(libraryPath: string): EvolutionConfig {
  return EvolutionConfigSchema.parse({
    paths: {
      config_dir: libraryPath,
      constitution: join(libraryPath, 'constitution.md'),
      version_file: join(libraryPath, 'meta', 'version.json'),
      metrics_file: join(libraryPath, 'meta', 'metrics.json'),
      evolution_log: join(libraryPath, 'meta', 'evolution-log.jsonl'),
      golden_suite: join(libraryPath, 'meta', 'golden-suite.jsonl'),
      session_log: join(libraryPath, 'memory', 'session-log.jsonl'),
    },
  });
}

function createEngine(libraryPath: string): EvolutionEngine {
  const config = buildEvolutionConfig(libraryPath);
    const useLlmJudges =
    process.env.EVOLUTION_USE_LLM_JUDGES === '1' && Boolean(process.env.ANTHROPIC_API_KEY?.trim());

  return new EvolutionEngine(config, useLlmJudges);

}

function listenForMissions(): void {
  const headers = { Authorization: `Bearer ${SANDBOXED_JWT}` };
  const es = new EventSource(`${SANDBOXED_URL}/api/control/stream`, { headers } as any);

  es.addEventListener('status', async (e: any) => {
    try {
      const data = JSON.parse(e.data);

      // If a mission ends successfully or fails, we run evolution
      if (data.state !== 'completed' && data.state !== 'failed') {
        return;
      }

      const missionId = data.mission_id;
      if (!missionId) {
        return;
      }

      console.log(`[worker] Mission ${missionId} finished. Running evolution pipeline...`);

      // Sync repo so /tmp/sandboxed-library contains required config files
      const libraryPath = git.sync();

      let engine: EvolutionEngine;
      try {
        engine = createEngine(libraryPath);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[worker] Failed to initialize evolution engine: ${msg}`);
        return;
      }

      // Fetch transcript
      const res = await axios.get(`${SANDBOXED_URL}/api/control/missions/${missionId}/events`, {
        headers,
        params: { types: 'user_message,assistant_message,tool_call,tool_result' },
      });

      const events = res.data;

      // Map to SessionSummary
      const user_messages: string[] = [];
      const assistant_messages: string[] = [];
      const tools_used = new Set<string>();
      let start: string | null = null;
      let end: string | null = null;

      for (const evt of events) {
        if (evt.event === 'user_message') user_messages.push(evt.data.content);
        if (evt.event === 'assistant_message') assistant_messages.push(evt.data.content);
        if (evt.event === 'tool_call') tools_used.add(evt.data.name);
        if (!start) start = evt.created_at;
        end = evt.created_at;
      }

      const started_at = start ?? new Date().toISOString();
      const ended_at = end ?? started_at;

      const summary: SessionSummary = {
        session_id: String(missionId),
        session_key: `mission:${missionId}`,
        user_id: typeof data.user_id === 'string' && data.user_id.length > 0 ? data.user_id : 'unknown',
        started_at,
        ended_at,
        user_messages,
        assistant_messages,
        tools_used: Array.from(tools_used),
        files_tracked: [],
        outcome: data.state === 'completed' ? 'success' : 'failure',
        cost_usd: 0,
      };

      // Run engine
      const result = await engine.afterSession(summary);

      // Commit back if changes applied
      if (result.changes_applied.length > 0) {
        console.log('[worker] Auto-evolution successful. Committing updates.');
        git.commitAndPush(`[evolution] Mission ${missionId} applied ${result.changes_applied.length} improvements.`);
      } else {
        console.log(`[worker] No evolutionary changes needed for mission ${missionId}.`);
      }
    } catch (err) {
      console.error('[worker] Error processing mission completion:', err);
    }
  });

  es.onerror = (err: any) => console.error('[worker] SSE stream error', err);
}

listenForMissions();
console.log('[evolution-worker] Listening for completed Sandboxed.sh missions...');
