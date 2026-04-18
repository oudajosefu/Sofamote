use std::sync::Arc;
use tokio::sync::{RwLock, broadcast};

use crate::config::{self, PersistedConfig};

#[derive(Debug, Clone)]
pub enum StateEvent {
    ActiveChanged(bool),
}

struct Inner {
    token: String,
    is_active: bool,
    auto_launch: bool,
}

pub struct AppState {
    inner: RwLock<Inner>,
    pub tx: broadcast::Sender<StateEvent>,
}

impl AppState {
    pub fn new(cfg: PersistedConfig) -> Arc<Self> {
        let (tx, _) = broadcast::channel(16);
        Arc::new(Self {
            inner: RwLock::new(Inner {
                token: cfg.token,
                is_active: cfg.is_active,
                auto_launch: cfg.auto_launch,
            }),
            tx,
        })
    }

    pub async fn token(&self) -> String {
        self.inner.read().await.token.clone()
    }

    pub async fn is_active(&self) -> bool {
        self.inner.read().await.is_active
    }

    pub async fn set_active(&self, next: bool) {
        let mut inner = self.inner.write().await;
        if inner.is_active == next {
            return;
        }
        inner.is_active = next;
        let cfg = PersistedConfig {
            token: inner.token.clone(),
            is_active: inner.is_active,
            auto_launch: inner.auto_launch,
        };
        drop(inner);
        config::save(&cfg);
        self.tx.send(StateEvent::ActiveChanged(next)).ok();
    }

    pub async fn set_auto_launch(&self, next: bool) {
        let mut inner = self.inner.write().await;
        inner.auto_launch = next;
        let cfg = PersistedConfig {
            token: inner.token.clone(),
            is_active: inner.is_active,
            auto_launch: inner.auto_launch,
        };
        drop(inner);
        config::save(&cfg);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<StateEvent> {
        self.tx.subscribe()
    }
}
