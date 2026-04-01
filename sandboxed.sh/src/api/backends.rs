//! Backend management API endpoints.

use std::sync::Arc;

use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::backend::registry::BackendInfo;

use super::auth::AuthUser;
use super::routes::AppState;

/// Backend information returned by API
#[derive(Debug, Clone, Serialize)]
pub struct BackendResponse {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    /// Whether the CLI for this backend is available on the system
    #[serde(default)]
    pub cli_available: bool,
    /// Only present for backends that support API-key gating in the UI (e.g. Claude Code).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key_configured: Option<bool>,
}

/// Agent information returned by API
#[derive(Debug, Clone, Serialize)]
pub struct AgentResponse {
    pub id: String,
    pub name: String,
}

fn cli_available_for_backend(backend_id: &str, settings: &serde_json::Value) -> bool {
    match backend_id {
        "claudecode" => {
            // Check for custom cli_path first, then default 'claude'
            let cli_path = settings
                .get("cli_path")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or("claude");
            check_cli_available(cli_path)
        }
        "amp" => {
            let cli_path = settings
                .get("cli_path")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or("amp");
            check_cli_available(cli_path)
        }
        "codex" => {
            let cli_path = settings
                .get("cli_path")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or("codex");
            check_cli_available(cli_path)
        }
        "opencode" => {
            // OpenCode uses oh-my-opencode or opencode CLI
            check_cli_available("oh-my-opencode") || check_cli_available("opencode")
        }
        _ => true,
    }
}

/// List all available backends
pub async fn list_backends(
    State(state): State<Arc<AppState>>,
    Extension(_user): Extension<AuthUser>,
) -> Json<Vec<BackendResponse>> {
    let registry = state.backend_registry.read().await;
    let backends: Vec<BackendInfo> = registry.list();
    drop(registry);

    let mut out = Vec::with_capacity(backends.len());
    for info in backends {
        let config_entry = state.backend_configs.get(&info.id).await;
        let enabled = config_entry.as_ref().map(|e| e.enabled).unwrap_or(true);
        let settings = config_entry
            .as_ref()
            .map(|e| e.settings.clone())
            .unwrap_or_else(|| serde_json::json!({}));

        let cli_available = cli_available_for_backend(&info.id, &settings);

        let api_key_configured = if info.id == "claudecode" {
            let configured = if let Some(store) = state.secrets.as_ref() {
                match store.list_secrets("claudecode").await {
                    Ok(secrets) => secrets.iter().any(|s| s.key == "api_key" && !s.is_expired),
                    Err(_) => false,
                }
            } else {
                false
            };
            Some(configured)
        } else {
            None
        };

        out.push(BackendResponse {
            id: info.id,
            name: info.name,
            enabled,
            cli_available,
            api_key_configured,
        });
    }

    Json(out)
}

/// Get a specific backend by ID
pub async fn get_backend(
    State(state): State<Arc<AppState>>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<String>,
) -> Result<Json<BackendResponse>, (StatusCode, String)> {
    let registry = state.backend_registry.read().await;
    match registry.get(&id) {
        Some(backend) => {
            drop(registry);

            let config_entry = state.backend_configs.get(&id).await;
            let enabled = config_entry.as_ref().map(|e| e.enabled).unwrap_or(true);
            let settings = config_entry
                .as_ref()
                .map(|e| e.settings.clone())
                .unwrap_or_else(|| serde_json::json!({}));
            let cli_available = cli_available_for_backend(&id, &settings);

            let api_key_configured = if id == "claudecode" {
                let configured = if let Some(store) = state.secrets.as_ref() {
                    match store.list_secrets("claudecode").await {
                        Ok(secrets) => secrets.iter().any(|s| s.key == "api_key" && !s.is_expired),
                        Err(_) => false,
                    }
                } else {
                    false
                };
                Some(configured)
            } else {
                None
            };

            Ok(Json(BackendResponse {
                id: backend.id().to_string(),
                name: backend.name().to_string(),
                enabled,
                cli_available,
                api_key_configured,
            }))
        }
        None => Err((StatusCode::NOT_FOUND, format!("Backend {} not found", id))),
    }
}

/// List agents for a specific backend
pub async fn list_backend_agents(
    State(state): State<Arc<AppState>>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<String>,
) -> Result<Json<Vec<AgentResponse>>, (StatusCode, String)> {
    let registry = state.backend_registry.read().await;
    let backend = registry
        .get(&id)
        .ok_or_else(|| (StatusCode::NOT_FOUND, format!("Backend {} not found", id)))?;

    // 1. Get native agents from the backend (usually CLI-based)
    let mut agents: Vec<AgentResponse> = match backend.list_agents().await {
        Ok(agents) => agents
            .into_iter()
            .map(|a| AgentResponse {
                id: a.id,
                name: a.name,
            })
            .collect(),
        Err(e) => {
            tracing::warn!("Failed to list native agents for {}: {}", id, e);
            Vec::new()
        }
    };

    // Default sort by name
    agents.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(Json(agents))
}

/// Backend configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendConfig {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub settings: serde_json::Value,
    /// Whether the CLI for this backend is available on the system
    #[serde(default)]
    pub cli_available: bool,
}

/// Check if a CLI command is available on the system
fn check_cli_available(cli_name: &str) -> bool {
    use std::process::Command;

    // Check if it's an absolute path
    if cli_name.starts_with('/') {
        return std::path::Path::new(cli_name).exists();
    }

    // Check using `which` command
    Command::new("which")
        .arg(cli_name)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Get backend configuration
pub async fn get_backend_config(
    State(state): State<Arc<AppState>>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<String>,
) -> Result<Json<BackendConfig>, (StatusCode, String)> {
    let registry = state.backend_registry.read().await;
    let backend = registry
        .get(&id)
        .ok_or_else(|| (StatusCode::NOT_FOUND, format!("Backend {} not found", id)))?;
    drop(registry);

    let config_entry = state.backend_configs.get(&id).await.ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            format!("Backend {} not configured", id),
        )
    })?;

    let mut settings = config_entry.settings.clone();

    if id == "claudecode" {
        let api_key_configured = if let Some(store) = state.secrets.as_ref() {
            match store.list_secrets("claudecode").await {
                Ok(secrets) => secrets.iter().any(|s| s.key == "api_key" && !s.is_expired),
                Err(_) => false,
            }
        } else {
            false
        };

        let mut obj = settings.as_object().cloned().unwrap_or_default();
        obj.insert(
            "api_key_configured".to_string(),
            serde_json::Value::Bool(api_key_configured),
        );
        settings = serde_json::Value::Object(obj);
    }

    // For amp backend, mask the api_key but indicate if configured
    if id == "amp" {
        let mut obj = settings.as_object().cloned().unwrap_or_default();
        let has_api_key = obj
            .get("api_key")
            .and_then(|v| v.as_str())
            .map(|s| !s.is_empty() && !s.starts_with("[REDACTED") && s != "********")
            .unwrap_or(false);
        obj.insert(
            "api_key_configured".to_string(),
            serde_json::Value::Bool(has_api_key),
        );
        // Mask the actual api_key value if present and valid, or clear invalid values
        if has_api_key {
            obj.insert(
                "api_key".to_string(),
                serde_json::Value::String("********".to_string()),
            );
        } else {
            // Clear invalid/redacted values so frontend shows empty field
            obj.remove("api_key");
        }
        settings = serde_json::Value::Object(obj);
    }

    // Check CLI availability based on backend type
    let cli_available = match id.as_str() {
        "claudecode" => {
            // Check for custom cli_path first, then default 'claude'
            let cli_path = settings
                .get("cli_path")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or("claude");
            check_cli_available(cli_path)
        }
        "amp" => {
            let cli_path = settings
                .get("cli_path")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or("amp");
            check_cli_available(cli_path)
        }
        "codex" => {
            let cli_path = settings
                .get("cli_path")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or("codex");
            check_cli_available(cli_path)
        }
        "opencode" => {
            // OpenCode uses oh-my-opencode or opencode CLI
            check_cli_available("oh-my-opencode") || check_cli_available("opencode")
        }
        _ => true,
    };

    Ok(Json(BackendConfig {
        id: backend.id().to_string(),
        name: backend.name().to_string(),
        enabled: config_entry.enabled,
        settings,
        cli_available,
    }))
}

/// Request to update backend configuration
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateBackendConfigRequest {
    pub settings: serde_json::Value,
    pub enabled: Option<bool>,
}

/// Update backend configuration
pub async fn update_backend_config(
    State(state): State<Arc<AppState>>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<String>,
    Json(req): Json<UpdateBackendConfigRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let registry = state.backend_registry.read().await;
    if registry.get(&id).is_none() {
        return Err((StatusCode::NOT_FOUND, format!("Backend {} not found", id)));
    }
    drop(registry);

    let updated_settings = match id.as_str() {
        "opencode" => {
            let settings = req.settings.as_object().ok_or_else(|| {
                (
                    StatusCode::BAD_REQUEST,
                    "Invalid settings payload".to_string(),
                )
            })?;
            let base_url = settings
                .get("base_url")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| (StatusCode::BAD_REQUEST, "base_url is required".to_string()))?;
            let default_agent = settings
                .get("default_agent")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            let permissive = settings
                .get("permissive")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            serde_json::json!({
                "base_url": base_url,
                "default_agent": default_agent,
                "permissive": permissive,
            })
        }
        "claudecode" => {
            let mut settings = req.settings.clone();
            if let Some(api_key) = settings.get("api_key").and_then(|v| v.as_str()) {
                let store = state.secrets.as_ref().ok_or_else(|| {
                    (
                        StatusCode::BAD_REQUEST,
                        "Secrets store not available".to_string(),
                    )
                })?;
                store
                    .set_secret("claudecode", "api_key", api_key, None)
                    .await
                    .map_err(|e| {
                        (
                            StatusCode::BAD_REQUEST,
                            format!("Failed to store API key: {}", e),
                        )
                    })?;
            }
            if let Some(obj) = settings.as_object_mut() {
                obj.remove("api_key");
            }
            settings
        }
        "amp" => {
            let settings = req.settings.as_object().ok_or_else(|| {
                (
                    StatusCode::BAD_REQUEST,
                    "Invalid settings payload".to_string(),
                )
            })?;

            tracing::debug!("Amp config update - received settings: {:?}", req.settings);

            // Get current config to preserve api_key if not being updated
            let current_config = state.backend_configs.get(&id).await;
            let current_api_key = current_config
                .as_ref()
                .and_then(|c| c.settings.get("api_key"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty() && !s.starts_with("[REDACTED") && *s != "********")
                .map(|s| s.to_string());

            // Get the new api_key if provided and valid (not masked/redacted)
            let new_api_key = settings
                .get("api_key")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty() && !s.starts_with("[REDACTED") && *s != "********")
                .map(|s| s.to_string());

            // Use new key if provided, otherwise keep existing
            let api_key = new_api_key.or(current_api_key);

            tracing::debug!(
                "Amp config update - api_key present: {}, api_key_len: {:?}",
                api_key.is_some(),
                api_key.as_ref().map(|k| k.len())
            );

            let cli_path = settings
                .get("cli_path")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            let default_mode = settings
                .get("default_mode")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "smart".to_string());
            let permissive = settings
                .get("permissive")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);

            serde_json::json!({
                "api_key": api_key,
                "cli_path": cli_path,
                "default_mode": default_mode,
                "permissive": permissive,
            })
        }
        _ => req.settings.clone(),
    };

    let updated = state
        .backend_configs
        .update_settings(&id, updated_settings, req.enabled)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to persist backend config: {}", e),
            )
        })?;

    if updated.is_none() {
        return Err((StatusCode::NOT_FOUND, format!("Backend {} not found", id)));
    }

    Ok(Json(serde_json::json!({
        "ok": true,
        "message": "Backend configuration updated."
    })))
}
