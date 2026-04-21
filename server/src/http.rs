use std::io::Cursor;
use std::sync::Arc;

use axum::extract::{FromRef, State};
use axum::http::{header, HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use image::GrayImage;
use qrcode::QrCode;
use rust_embed::RustEmbed;

use crate::single_instance::{
    INSTANCE_HEADER_NAME, INSTANCE_HEADER_VALUE, INSTANCE_PROBE_PATH, INSTANCE_VERSION_HEADER_NAME,
};
use crate::state::AppState;
use crate::types::VERSION;
use crate::ws::ws_handler;

#[derive(RustEmbed)]
#[folder = "$CARGO_MANIFEST_DIR/../client/dist"]
struct ClientAssets;

/// Axum router state: only app state — assets are embedded in the binary.
#[derive(Clone)]
pub struct RouterState {
    pub app: Arc<AppState>,
}

impl FromRef<RouterState> for Arc<AppState> {
    fn from_ref(s: &RouterState) -> Self {
        s.app.clone()
    }
}

pub fn build_router(app: Arc<AppState>, pairing_url: String) -> Router {
    let state = RouterState { app };

    Router::new()
        .route("/", get(ws_handler))
        .route(INSTANCE_PROBE_PATH, get(instance_probe_handler))
        .route("/qr.png", get(move |s| qr_handler(s, pairing_url.clone())))
        .fallback(static_handler)
        .with_state(state)
}

/// Serves embedded static files. Falls back to index.html for SPA routing.
async fn static_handler(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');

    if let Some(file) = ClientAssets::get(path) {
        return embed_response(path, file);
    }

    if let Some(file) = ClientAssets::get("index.html") {
        return embed_response("index.html", file);
    }

    StatusCode::NOT_FOUND.into_response()
}

fn embed_response(path: &str, file: rust_embed::EmbeddedFile) -> Response {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, mime.as_ref().parse().unwrap());
    // Service worker and entry point must not be cached; hashed assets can be immutable.
    let cache = if matches!(path, "index.html" | "sw.js" | "registerSW.js") {
        "no-cache"
    } else {
        "public, max-age=31536000, immutable"
    };
    headers.insert(header::CACHE_CONTROL, cache.parse().unwrap());
    (StatusCode::OK, headers, file.data.to_vec()).into_response()
}

/// Returns the embedded index.html bytes; called by ws_handler for plain browser GETs.
pub fn get_index_html() -> Option<Vec<u8>> {
    ClientAssets::get("index.html").map(|f| f.data.to_vec())
}

async fn instance_probe_handler() -> Response {
    instance_probe_response()
}

fn instance_probe_response() -> Response {
    let mut headers = HeaderMap::new();
    headers.insert(INSTANCE_HEADER_NAME, INSTANCE_HEADER_VALUE.parse().unwrap());
    headers.insert(INSTANCE_VERSION_HEADER_NAME, VERSION.parse().unwrap());
    (StatusCode::NO_CONTENT, headers).into_response()
}

async fn qr_handler(State(_): State<Arc<AppState>>, pairing_url: String) -> impl IntoResponse {
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
    let img: GrayImage = code
        .render::<image::Luma<u8>>()
        .min_dimensions(512, 512)
        .quiet_zone(true)
        .build();
    let dynamic = image::DynamicImage::ImageLuma8(img);
    let mut buf = Vec::new();
    dynamic.write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::instance_probe_response;
    use crate::single_instance::{
        INSTANCE_HEADER_NAME, INSTANCE_HEADER_VALUE, INSTANCE_VERSION_HEADER_NAME,
    };
    use crate::types::VERSION;
    use axum::http::StatusCode;

    #[test]
    fn instance_probe_response_has_expected_marker_headers() {
        let response = instance_probe_response();

        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert_eq!(
            response.headers().get(INSTANCE_HEADER_NAME).unwrap(),
            INSTANCE_HEADER_VALUE
        );
        assert_eq!(
            response
                .headers()
                .get(INSTANCE_VERSION_HEADER_NAME)
                .unwrap(),
            VERSION
        );
    }
}
