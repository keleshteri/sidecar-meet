use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post},
};
use serde_json::{Value, json};
use sidecar_core::{App, JoinOptions};
use std::sync::Arc;

type ApiError = (StatusCode, Json<Value>);
fn error(status: StatusCode, message: impl ToString) -> ApiError {
    (status, Json(json!({"message":message.to_string()})))
}
fn router(app: Arc<App>) -> Router {
    Router::new()
        .route(
            "/health",
            get(|| async { Json(json!({"status":"ok", "backend":"rust"})) }),
        )
        .route("/audio/devices", get(devices))
        .route("/meetings", get(list))
        .route("/meetings/join", post(join))
        .route("/meetings/{id}", delete(leave))
        .route("/meetings/{id}/transcript", get(transcript))
        .with_state(app)
}

async fn devices() -> Result<Json<Vec<String>>, ApiError> {
    sidecar_core::audio_devices()
        .map(Json)
        .map_err(|e| error(StatusCode::INTERNAL_SERVER_ERROR, e))
}
async fn list(State(app): State<Arc<App>>) -> Json<Vec<sidecar_core::Meeting>> {
    Json(app.list())
}
async fn join(
    State(app): State<Arc<App>>,
    Json(options): Json<JoinOptions>,
) -> Result<(StatusCode, Json<sidecar_core::Meeting>), ApiError> {
    tokio::task::spawn_blocking(move || app.join(options))
        .await
        .map_err(|e| error(StatusCode::INTERNAL_SERVER_ERROR, e))?
        .map(|m| (StatusCode::CREATED, Json(m)))
        .map_err(|e| error(StatusCode::BAD_REQUEST, format!("{e:#}")))
}
async fn leave(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let response_id = id.clone();
    let left = tokio::task::spawn_blocking(move || app.leave(&id))
        .await
        .map_err(|e| error(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    if left {
        Ok(Json(json!({"id":response_id,"left":true})))
    } else {
        Err(error(StatusCode::NOT_FOUND, "No meeting with that id"))
    }
}
async fn transcript(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
) -> Result<Json<sidecar_core::Meeting>, ApiError> {
    app.transcript(&id)
        .map(Json)
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "No transcript for that id"))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    sidecar_core::load_env();
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).is_some_and(|a| a == "transcribe") {
        anyhow::ensure!(
            args.len() == 4,
            "Usage: sidecar-api transcribe MODEL.bin AUDIO.wav"
        );
        println!("{}", sidecar_core::transcribe_wav(&args[2], &args[3])?);
        return Ok(());
    }
    let app = Arc::new(App::default());
    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "4343".into())
        .parse::<u16>()?;
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await?;
    println!("sidecar-meet Rust API: http://127.0.0.1:{port}");
    axum::serve(listener, router(app.clone()))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    tokio::task::spawn_blocking(move || app.shutdown()).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tower::ServiceExt;
    #[tokio::test]
    async fn http_routes_and_validation() {
        let app = router(Arc::new(App::default()));
        for (method, uri, body, status) in [
            ("GET", "/health", "", 200),
            ("GET", "/meetings", "", 200),
            ("GET", "/meetings/missing/transcript", "", 404),
            ("DELETE", "/meetings/missing", "", 404),
            (
                "POST",
                "/meetings/join",
                r#"{"meetingUrl":"file:///secret"}"#,
                400,
            ),
            ("POST", "/meetings/join", r#"{}"#, 422),
        ] {
            let request = axum::http::Request::builder()
                .method(method)
                .uri(uri)
                .header("content-type", "application/json")
                .body(axum::body::Body::from(body))
                .unwrap();
            let response = app.clone().oneshot(request).await.unwrap();
            assert_eq!(response.status().as_u16(), status, "{method} {uri}");
        }
    }
}
