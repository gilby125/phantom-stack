# Phantom Sidecar Stack

A unified set of autonomous agent extensions for **sandboxed.sh**.

This repository now contains both the base orchestrator and the sidecars in one deployable tree:
- `sandboxed.sh`
- `phantom-relay`
- `memory-mcp`
- `evolution-worker`

The compose file builds `sandboxed.sh` locally from `./sandboxed.sh`, so the stack is self-contained.

## Repos

- Stack code: `https://github.com/gilby125/phantom-stack`
- Evolving library: `https://github.com/gilby125/phantom-library`

## Local bootstrap

1. Generate a local `.env` with a dashboard password, JWT secret, and service token:
   ```bash
   ./scripts/bootstrap-local-env.sh
   ```
2. Fill in `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` in `.env` if you want Slack.
3. Start the stack:
   ```bash
   docker compose up -d --build
   ```

Open `http://localhost:3333` for the dashboard.

## Recovery (401 / GLIBC / network)

If the stack is in a partial failure state (e.g. workers getting `401`, or `phantom-relay` crashing with a `GLIBC_*` error), do a clean rebuild:

```bash
./scripts/nuke-and-rebuild.sh --yes
```

If you only need to fix a desynced/expired worker service token (without changing your secret), regenerate `SANDBOXED_JWT` from `SANDBOXED_JWT_SECRET`:

```bash
./scripts/regen-service-jwt.sh
```

## ⚙️ Configuration

For detailed post-deployment setup, including **OpenCode** architecture, Slack/Telegram integration, and Memory Tier (Qdrant/Ollama) configuration, see the:

👉 **[Post-Deployment Configuration Guide](docs/CONFIG_GUIDE.md)**

## Components

### `memory-mcp`
An MCP server backed by Qdrant and Ollama.
- Transport: Streamable HTTP at `http://memory-mcp:3333/mcp`
- Purpose: long-term episodic and semantic memory

### `phantom-relay`
A Slack-to-sandboxed bridge.
- Creates missions with backend `opencode`
- Streams mission output back into Slack threads

### `evolution-worker`
A post-mission evolution loop.
- Watches mission completions over SSE
- Pulls and updates `phantom-library`
- Defaults to heuristic judges; enable Anthropic judges explicitly with `EVOLUTION_USE_LLM_JUDGES=1`
