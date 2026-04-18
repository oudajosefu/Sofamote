use std::io::Cursor;
use std::path::PathBuf;
use std::sync::Arc;

use axum::Router;
use axum::extract::{FromRef, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::IntoResponse;
use axum::routing::get;
use image::GrayImage;
use qrcode::QrCode;
use tower_http::services::{ServeDir, ServeFile};

use crate::state::AppState;
use crate::ws::ws_handler;

/// Axum router state: includes both app state and the path to index.html.
/// `FromRef` lets handlers extract `Arc<AppState>` directly when they don't need the index path.
#[derive(Clone)]
pub struct RouterState {
    pub app: Arc<AppState>,
    pub index_html: PathBuf,
}

impl FromRef<RouterState> for Arc<AppState> {
    fn from_ref(s: &RouterState) -> Self {
        s.app.clone()
    }
}

pub fn build_router(app: Arc<AppState>, client_dir: PathBuf, pairing_url: String) -> Router {
    let state = RouterState {
        app,
        index_html: client_dir.join("index.html"),
    };

    Router::new()
        .route("/", get(ws_handler))
        .route("/qr.png", get(move |s| qr_handler(s, pairing_url.clone())))
        .fallback_service(
            ServeDir::new(&client_dir)
                .not_found_service(ServeFile::new(client_dir.join("index.html"))),
        )
        .with_state(state)
}

async fn qr_handler(
    State(_): State<Arc<AppState>>,
    pairing_url: String,
) -> impl IntoResponse {
    match generate_qr_png(&pairing_url) {
        Ok(bytes) => {
            let mut headers = HeaderMap::new();
            headers.insert(header::CONTENT_TYPE, "image/png".parse().unwrap());
            (StatusCode::OK, headers, bytes).into_response()
        }
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

fn generate_qr_png(url: &str) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let code = QrCode::new(url.as_bytes())?;
    let img: GrayImage = code.render::<image::Luma<u8>>()
        .min_dimensions(512, 512)
        .quiet_zone(true)
        .build();
    let dynamic = image::DynamicImage::ImageLuma8(img);
    let mut buf = Vec::new();
    dynamic.write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)?;
    Ok(buf)
}
