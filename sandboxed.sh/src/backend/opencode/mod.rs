use anyhow::Error;
use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use tracing::{debug, error, info};

use crate::backend::events::ExecutionEvent;
use crate::backend::shared::{convert_cli_event, CliEvent, ProcessHandle};
use crate::backend::{AgentInfo, Backend, Session, SessionConfig};

pub struct OpenCodeBackend {
    id: String,
    name: String,
}

impl OpenCodeBackend {
    pub fn new() -> Self {
        Self {
            id: "opencode".to_string(),
            name: "OpenCode".to_string(),
        }
    }
}

#[async_trait]
impl Backend for OpenCodeBackend {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        &self.name
    }

    async fn list_agents(&self) -> Result<Vec<AgentInfo>, Error> {
        // OpenCode agents are managed via the CLI flags/config.
        // We provide a set of standard identities.
        Ok(vec![
            AgentInfo {
                id: "Sisyphus".to_string(),
                name: "Sisyphus".to_string(),
            },
            AgentInfo {
                id: "default".to_string(),
                name: "OpenCode".to_string(),
            },
        ])
    }

    async fn create_session(&self, config: SessionConfig) -> Result<Session, Error> {
        // OpenCode handles session isolation via working directory.
        // We use a generated UUID for tracking in our own DB.
        Ok(Session {
            id: uuid::Uuid::new_v4().to_string(),
            directory: config.directory,
            model: config.model,
            agent: config.agent,
        })
    }

    async fn send_message_streaming(
        &self,
        session: &Session,
        message: &str,
    ) -> Result<(mpsc::Receiver<ExecutionEvent>, JoinHandle<()>), Error> {
        let (event_tx, event_rx) = mpsc::channel(100);
        let directory = session.directory.clone();
        let model = session.model.clone();
        let agent = session.agent.clone();
        let message = message.to_string();

        info!(
            backend = "opencode",
            session_id = %session.id,
            "Starting OpenCode CLI mission"
        );

        let join_handle = tokio::spawn(async move {
            let mut args = vec!["--stream-json".to_string()];

            if let Some(m) = model {
                args.push("--model".to_string());
                args.push(m);
            }

            if let Some(a) = agent {
                args.push("--agent".to_string());
                args.push(a);
            }

            // Always run in the session directory
            args.push("--prompt".to_string());
            args.push(message);

            debug!("Executing: opencode {}", args.join(" "));

            let mut child = match tokio::process::Command::new("opencode")
                .args(&args)
                .current_dir(&directory)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
            {
                Ok(child) => child,
                Err(e) => {
                    error!("Failed to spawn opencode process: {}", e);
                    let _ = event_tx
                        .send(ExecutionEvent::Error {
                            message: format!("Failed to spawn opencode: {}", e),
                        })
                        .await;
                    return;
                }
            };

            let stdout = child.stdout.take().unwrap();
            let mut reader = BufReader::new(stdout).lines();
            let child_arc = Arc::new(Mutex::new(Some(child)));
            let mut pending_tools = HashMap::new();

            // Track process in a handle so it can be killed if cancelled
            let _handle = ProcessHandle::new(Arc::clone(&child_arc), tokio::spawn(async {}));

            while let Ok(Some(line)) = reader.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }

                match serde_json::from_str::<CliEvent>(&line) {
                    Ok(cli_event) => {
                        let events = convert_cli_event(cli_event, &mut pending_tools);
                        for event in events {
                            if event_tx.send(event).await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(e) => {
                        debug!("Failed to parse OpenCode NDJSON line: {} (line: {})", e, line);
                    }
                }
            }

            // Clean up
            let child = {
                let mut guard = child_arc.lock().await;
                guard.take()
            };
            if let Some(mut child) = child {
                let _ = child.wait().await;
            }
        });

        Ok((event_rx, join_handle))
    }
}

pub fn registry_entry() -> Arc<dyn Backend> {
    Arc::new(OpenCodeBackend::new())
}
