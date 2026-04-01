//! Dashboard-facing LLM proxy helpers.
//!
//! The dashboard stores a user-selected LLM configuration in localStorage for
//! UX features such as auto-generated mission titles. Browser-side requests to
//! third-party providers like Gemini can hit CORS restrictions, so this module
//! proxies the completion call through the authenticated backend.

use std::{net::IpAddr, sync::Arc};

use axum::{
    extract::State,
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

use super::routes::AppState;

#[derive(Debug, Deserialize, Serialize)]
pub struct DashboardChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct DashboardChatCompletionRequest {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub messages: Vec<DashboardChatMessage>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub temperature: Option<f32>,
}

#[derive(Debug, Serialize)]
pub struct DashboardChatCompletionChoiceMessage {
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct DashboardChatCompletionChoice {
    pub message: DashboardChatCompletionChoiceMessage,
}

#[derive(Debug, Serialize)]
pub struct DashboardChatCompletionResponse {
    pub choices: Vec<DashboardChatCompletionChoice>,
}

fn is_internal_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(ipv4) => {
            ipv4.is_loopback()
                || ipv4.is_private()
                || ipv4.is_link_local()
                || ipv4.is_broadcast()
                || ipv4.is_documentation()
                || ipv4.octets() == [169, 254, 169, 254]
                || ipv4.is_unspecified()
        }
        IpAddr::V6(ipv6) => {
            ipv6.is_loopback()
                || ipv6.is_unspecified()
                || if let Some(ipv4) = ipv6.to_ipv4_mapped() {
                    is_internal_ip(&IpAddr::V4(ipv4))
                } else {
                    false
                }
                || (ipv6.segments()[0] & 0xfe00) == 0xfc00
                || (ipv6.segments()[0] & 0xffc0) == 0xfe80
        }
    }
}

fn validate_provider_base_url(url: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(url).map_err(|e| format!("Invalid base URL: {}", e))?;

    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(format!("Disallowed URL scheme: {}", other)),
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| "Base URL has no host".to_string())?;
    let host_lower = host.to_lowercase();
    if host_lower == "localhost" || host_lower.ends_with(".localhost") || host_lower == "0.0.0.0" {
        return Err("Requests to localhost are not allowed".to_string());
    }

    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_internal_ip(&ip) {
            return Err(format!(
                "Requests to internal IP addresses are not allowed: {}",
                ip
            ));
        }
    }

    let port = parsed.port_or_known_default().unwrap_or(80);
    if let Ok(addrs) = std::net::ToSocketAddrs::to_socket_addrs(&(host, port)) {
        for addr in addrs {
            if is_internal_ip(&addr.ip()) {
                return Err(format!(
                    "Base URL resolves to internal IP address: {}",
                    addr.ip()
                ));
            }
        }
    }

    Ok(parsed)
}

pub async fn chat_completions(
    State(state): State<Arc<AppState>>,
    Json(request): Json<DashboardChatCompletionRequest>,
) -> Result<Json<DashboardChatCompletionResponse>, (StatusCode, String)> {
    let base_url = request.base_url.trim();
    if base_url.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Base URL is empty".to_string()));
    }
    if request.api_key.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "API key is empty".to_string()));
    }
    if request.model.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Model is empty".to_string()));
    }
    if request.messages.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Messages are empty".to_string()));
    }

    let base_url = validate_provider_base_url(base_url)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    let url = base_url
        .join("chat/completions")
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid provider URL: {}", e)))?;
    let body = serde_json::json!({
        "model": request.model,
        "messages": request.messages,
        "max_tokens": request.max_tokens.unwrap_or(64),
        "temperature": request.temperature.unwrap_or(0.3),
    });

    let response = state
        .http_client
        .post(url)
        .header("Content-Type", "application/json")
        .header(
            "Authorization",
            format!("Bearer {}", request.api_key.trim()),
        )
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                format!("Failed to contact LLM provider: {}", e),
            )
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err((
            StatusCode::BAD_GATEWAY,
            if text.is_empty() {
                format!("LLM provider returned HTTP {}", status)
            } else {
                format!("LLM provider returned HTTP {}: {}", status, text)
            },
        ));
    }

    let payload: serde_json::Value = response.json().await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            format!("Failed to parse LLM provider response: {}", e),
        )
    })?;

    let content = payload
        .get("choices")
        .and_then(|choices| choices.as_array())
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(|content| content.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    Ok(Json(DashboardChatCompletionResponse {
        choices: vec![DashboardChatCompletionChoice {
            message: DashboardChatCompletionChoiceMessage { content },
        }],
    }))
}
