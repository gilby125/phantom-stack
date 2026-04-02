//! # Open Agent Panel
//!
//! Cloud orchestrator for AI coding agents (Claude Code, OpenCode, Codex).
//!
//! This library provides:
//! - HTTP APIs for missions, workspaces, MCP tooling, and library sync
//! - Standardized backend wrappers for direct CLI execution
//! - Streaming events for mission telemetry in the dashboards
//!
//! ## Architecture
//!
//! The orchestrator spawns AI agent CLIs (like `opencode` or `claude`) as subprocesses
//! within a sandboxed environment. It maps their NDJSON output streams to a unified
//! `ExecutionEvent` protocol.
//!
//! ## Task Flow
//! 1. Receive mission task via API
//! 2. Spawn agent CLI subprocess
//! 3. Stream real-time events (thinking, tool calls, results) via NDJSON
//! 4. Store logs and return final result
//!
//! ## Modules
//! - `agents`: Task execution abstractions
//! - `backend`: Standardized agent CLI integrations
//! - `task`: Task definitions and lightweight cost tracking

pub mod agents;
pub mod ai_providers;
pub mod api;
pub mod backend;
pub mod backend_config;
pub mod config;
pub mod cost;
pub mod library;
pub mod mcp;
pub mod nspawn;
pub mod pkg_manager;
pub mod provider_health;
pub mod secrets;
pub mod settings;
pub mod skills_registry;
pub mod task;
pub mod tools;
pub mod util;
pub mod workspace;
pub mod workspace_exec;

pub use ai_providers::{AIProvider, AIProviderStore, ProviderType};
pub use config::Config;
pub use settings::{Settings, SettingsStore};
