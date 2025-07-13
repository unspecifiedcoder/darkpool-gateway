// src/api.rs
use crate::{config::Config, database::Database, models::{HistoricalPosition, PaginatedResponse}};
use anyhow::Result;
use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::Json,
    routing::get,
    Router,
};
use ethers::utils::keccak256;
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

// The shared state for our Axum handlers
type AppState = State<Arc<Database>>;


async fn check_auth(headers: &HeaderMap) -> Result<[u8; 32], StatusCode> {
    let sig_header = headers
        .get("x-signature")
        .and_then(|h| h.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let msg_header = headers
        .get("x-message")
        .and_then(|h| h.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    // 1. Decode the signature from the header
    let sig_bytes = hex::decode(sig_header.strip_prefix("0x").unwrap_or(sig_header))
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let signature = ethers::core::types::Signature::try_from(sig_bytes.as_slice())
        .map_err(|_| StatusCode::BAD_REQUEST)?;

    // 2. Recover the EOA address from the signature and message
    let recovered_addr = signature
        .recover(msg_header)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    // 3. Derive the public key using the exact same logic as the smart contract and TS client.
    // `ethers::abi::encode_packed` with a single address is equivalent to just getting
    // the raw bytes of the address. `keccak256` then hashes those 20 bytes.
    let pub_key = keccak256(recovered_addr.as_bytes());
    
    Ok(pub_key)
}

#[derive(Deserialize)]
pub struct PaginationParams {
    cursor: Option<usize>,
    page_size: Option<usize>,
}

// GET /positions/open
async fn get_open_positions(State(db): AppState, headers: HeaderMap) -> Result<Json<Value>, StatusCode> {
    let owner_pub_key = check_auth(&headers).await?;
    let positions = db.get_open_positions(&owner_pub_key).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({ "open_positions": positions })))
}


// GET /positions/history
async fn get_historical_positions(
    State(db): AppState, headers: HeaderMap, Query(pagination): Query<PaginationParams>,
) -> Result<Json<PaginatedResponse<HistoricalPosition>>, StatusCode> {
    let owner_pub_key = check_auth(&headers).await?;
    let page_size = pagination.page_size.unwrap_or(20);
    let positions = db.get_historical_positions(&owner_pub_key, pagination.cursor, page_size)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(positions))
}

// GET /notes/unspent
async fn get_unspent_notes(State(db): AppState, headers: HeaderMap) -> Result<Json<Value>, StatusCode> {
    // For privacy, the user provides the hash they can build from their secret.
    let receiver_hash_header = headers.get("x-receiver-hash").and_then(|h| h.to_str().ok()).ok_or(StatusCode::BAD_REQUEST)?;
    let receiver_hash = hex::decode(receiver_hash_header.strip_prefix("0x").unwrap_or(receiver_hash_header)).map_err(|_| StatusCode::BAD_REQUEST)?;
    let notes = db.get_unspent_notes(&receiver_hash).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({ "unspent_notes": notes })))
}

async fn set_metadata(State(db): AppState, headers: HeaderMap, body: axum::body::Bytes) -> Result<StatusCode, StatusCode> {
    if body.len() > 4096 { return Err(StatusCode::PAYLOAD_TOO_LARGE); }
    let owner_pub_key = check_auth(&headers).await?;
    db.user_metadata.insert(owner_pub_key, body.to_vec()).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::OK)
}

// GET /metadata
async fn get_metadata(State(db): AppState, headers: HeaderMap) -> Result<Json<Value>, StatusCode> {
    let owner_pub_key = check_auth(&headers).await?;
    let metadata = db.user_metadata.get(&owner_pub_key).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({ "encrypted_metadata": metadata.map(|m| hex::encode(m)) })))
}

pub async fn run_api_server(config: Arc<Config>, db: Arc<Database>) -> Result<()> {
    let cors = CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any);
    let app = Router::new()
        .route("/positions/open", get(get_open_positions))
        .route("/positions/history", get(get_historical_positions))
        .route("/notes/unspent", get(get_unspent_notes))
        .route("/metadata", get(get_metadata).post(set_metadata))
        .with_state(Arc::clone(&db))
        .layer(cors);

    let listener = tokio::net::TcpListener::bind(&config.server_bind_address).await?;
    println!("[API Server] Listening on http://{}", &config.server_bind_address);
    axum::serve(listener, app).await?;
    Ok(())
}