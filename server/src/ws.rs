use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Query, State, WebSocketUpgrade};
use axum::http::{StatusCode, header};
use axum::response::IntoResponse;
use subtle::ConstantTimeEq;
use tokio::sync::broadcast;

use crate::http::RouterState;
use crate::keystrokes;
use crate::profiles;
use crate::state::{AppState, StateEvent};
use crate::types::{Command, ServerMessage, ALL_PROFILES, VERSION};

pub async fn ws_handler(
    ws: Option<WebSocketUpgrade>,
    Query(params): Query<HashMap<String, String>>,
    State(rs): State<RouterState>,
) -> impl IntoResponse {
    // Regular browser GET (no Upgrade header) — serve the SPA entry point
    let ws = match ws {
        Some(w) => w,
        None => {
            return match crate::http::get_index_html() {
                Some(bytes) => (
                    [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
                    bytes,
                )
                    .into_response(),
                None => StatusCode::NOT_FOUND.into_response(),
            };
        }
    };

    let provided = params.get("t").map(String::as_str).unwrap_or("");
    let token = rs.app.token().await;

    if !bool::from(provided.as_bytes().ct_eq(token.as_bytes())) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    ws.on_upgrade(move |socket| handle_socket(socket, rs.app))
        .into_response()
}

async fn handle_socket(mut socket: WebSocket, state: Arc<AppState>) {
    let hello = ServerMessage::Hello { version: VERSION, profiles: ALL_PROFILES };
    if send_msg(&mut socket, &hello).await.is_err() {
        return;
    }

    let active = state.is_active().await;
    if send_msg(&mut socket, &ServerMessage::State { active }).await.is_err() {
        return;
    }

    let mut rx = state.subscribe();

    loop {
        tokio::select! {
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if handle_command(&text, &mut socket, &state).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {}
                }
            }
            event = rx.recv() => {
                match event {
                    Ok(StateEvent::ActiveChanged(active)) => {
                        if send_msg(&mut socket, &ServerMessage::State { active }).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {} // continue
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
}

async fn handle_command(
    text: &str,
    socket: &mut WebSocket,
    state: &AppState,
) -> Result<(), ()> {
    let cmd: Command = match serde_json::from_str(text) {
        Ok(c) => c,
        Err(e) => {
            let msg = ServerMessage::Error { message: format!("invalid command: {e}") };
            return send_msg(socket, &msg).await;
        }
    };

    if !state.is_active().await {
        return send_msg(socket, &ServerMessage::Ack { suppressed: Some(true) }).await;
    }

    let result = tokio::task::spawn_blocking(move || dispatch(cmd)).await;

    match result {
        Ok(Ok(())) => send_msg(socket, &ServerMessage::Ack { suppressed: None }).await,
        Ok(Err(e)) => {
            send_msg(socket, &ServerMessage::Error { message: e }).await
        }
        Err(_) => {
            send_msg(socket, &ServerMessage::Error { message: "internal error".into() }).await
        }
    }
}

fn dispatch(cmd: Command) -> Result<(), String> {
    match cmd {
        Command::Key { key, mods } => keystrokes::tap(key, &mods),
        Command::Combo { keys } => keystrokes::combo(&keys),
        Command::Action { name, profile } => {
            let recipe = profiles::resolve_action(profile, name)
                .ok_or_else(|| format!("no mapping for action {name:?} in profile {profile:?}"))?;
            if let Some(combo) = &recipe.combo {
                keystrokes::combo(combo)
            } else if let Some(key) = recipe.key {
                keystrokes::tap(key, &recipe.mods)
            } else {
                Err("empty recipe".into())
            }
        }
    }
}

async fn send_msg(socket: &mut WebSocket, msg: &ServerMessage<'_>) -> Result<(), ()> {
    let text = serde_json::to_string(msg).map_err(|_| ())?;
    socket.send(Message::Text(text)).await.map_err(|_| ())
}
