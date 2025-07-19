use crate::{
    config::Config,
    database::Database,
    models::{HistoricalPosition, PaginatedResponse},
};
use anyhow::Result;
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::Json,
    routing::get,
    Router,
};
use ethers::{abi::Address, types::H256, utils::keccak256};
use serde::Deserialize;
use serde_json::Value;
use std::{str::FromStr, sync::Arc};
use tower_http::cors::{Any, CorsLayer};

// The shared state for our Axum handlers
type AppState = State<Arc<Database>>;

async fn check_auth(headers: &HeaderMap) -> Result<[u8; 32], StatusCode> {
    // println!("[AUTH] Starting authentication check");

    let sig_header = headers
        .get("x-signature")
        .and_then(|h| h.to_str().ok())
        .ok_or_else(|| {
            // println!("[AUTH] Error: x-signature header missing or invalid");
            StatusCode::UNAUTHORIZED
        })?;
    // println!("[AUTH] Found x-signature header");

    let msg_header = headers
        .get("x-message")
        .and_then(|h| h.to_str().ok())
        .ok_or_else(|| {
            // println!("[AUTH] Error: x-message header missing or invalid");
            StatusCode::UNAUTHORIZED
        })?;
    // println!("[AUTH] Found x-message header");

    // 1. Decode the signature from the header
    // println!("[AUTH] Decoding signature from header");
    let sig_bytes =
        hex::decode(sig_header.strip_prefix("0x").unwrap_or(sig_header)).map_err(|e| {
            println!("[AUTH] Error decoding signature: {}", e);
            StatusCode::BAD_REQUEST
        })?;
    let signature =
        ethers::core::types::Signature::try_from(sig_bytes.as_slice()).map_err(|e| {
            println!("[AUTH] Error creating signature from bytes: {}", e);
            StatusCode::BAD_REQUEST
        })?;
    // println!("[AUTH] Signature decoded successfully");

    // 2. Recover the EOA address from the signature and message
    // println!("[AUTH] Recovering EOA address");
    let recovered_addr = signature.recover(msg_header).map_err(|e| {
        println!("[AUTH] Error recovering address: {}", e);
        StatusCode::UNAUTHORIZED
    })?;
    // println!("[AUTH] EOA address recovered: {:?}", recovered_addr);

    // 3. Derive the public key using the exact same logic as the smart contract and TS client.
    // println!("[AUTH] Deriving public key");
    let pub_key = keccak256(recovered_addr.as_bytes());
    // println!("[AUTH] Public key derived: {:?}", hex::encode(pub_key));

    // println!("[AUTH] Authentication check successful");
    Ok(pub_key)
}

#[derive(Deserialize)]
pub struct PaginationParams {
    cursor: Option<usize>,
    page_size: Option<usize>,
}

// GET /positions/{positionId}
async fn get_position_by_id(
    State(db): AppState,
    Path(position_id_str): Path<String>,
) -> Result<Json<Value>, StatusCode> {
    let position_id = H256::from_str(
        position_id_str.strip_prefix("0x").unwrap_or(&position_id_str)
    ).map_err(|_| StatusCode::BAD_REQUEST)?;

    match db.get_position_by_id(position_id.as_bytes()) {
        Ok(Some(position_data)) => Ok(Json(serde_json::json!({ "position": position_data }))),
        Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

// GET /positions/open
async fn get_private_open_positions(
    State(db): AppState,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    let owner_pub_key = check_auth(&headers).await?;
    let positions = db
        .get_open_positions(&owner_pub_key)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({ "open_positions": positions })))
}

// GET /positions/history
async fn get_private_historical_positions(
    State(db): AppState,
    headers: HeaderMap,
    Query(pagination): Query<PaginationParams>,
) -> Result<Json<PaginatedResponse<HistoricalPosition>>, StatusCode> {
    // println!("[API] Received request for GET /positions/history");
    let owner_pub_key = check_auth(&headers).await?;
    let page_size = pagination.page_size.unwrap_or(20);
    println!("[API] Attempting to get historical positions for public key: {:?} with page size: {} and cursor: {:?}", hex::encode(owner_pub_key), page_size, pagination.cursor);
    let positions = db
        .get_historical_positions(&owner_pub_key, pagination.cursor, page_size)
        .map_err(|e| {
            println!(
                "[API] Error getting historical positions from database: {}",
                e
            );
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    // println!("[API] Successfully retrieved historical positions");
    Ok(Json(positions))
}

// GET /notes/unspent
async fn get_unspent_notes(
    State(db): AppState,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    println!("[API] Received request for GET /notes/unspent");
    // For privacy, the user provides the hash they can build from their secret.
    let receiver_hash_header = headers
        .get("x-receiver-hash")
        .and_then(|h| h.to_str().ok())
        .ok_or_else(|| {
            // println!("[API] Error: x-receiver-hash header missing or invalid");
            StatusCode::BAD_REQUEST
        })?;
    // println!("[API] Found x-receiver-hash header {}" , receiver_hash_header);

    let receiver_hash = hex::decode(
        receiver_hash_header
            .strip_prefix("0x")
            .unwrap_or(receiver_hash_header),
    )
    .map_err(|e| {
        println!("[API] Error decoding receiver hash: {}", e);
        StatusCode::BAD_REQUEST
    })?;
    // println!("[API] Attempting to get unspent notes for receiver hash: {:?}", hex::encode(&receiver_hash));
    let notes = db.get_unspent_notes(&receiver_hash).map_err(|e| {
        println!("[API] Error getting unspent notes from database: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    // println!("[API] Successfully retrieved {} unspent notes", notes.len());
    Ok(Json(serde_json::json!({ "unspent_notes": notes })))
}

async fn set_metadata(
    State(db): AppState,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<StatusCode, StatusCode> {
    // println!("[API] Received request for POST /metadata");
    if body.len() > 4096 {
        // println!("[API] Error: Payload size ({}) exceeds 4096 bytes", body.len());
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }
    let owner_pub_key = check_auth(&headers).await?;
    // println!("[API] Attempting to set metadata for public key: {:?}", hex::encode(owner_pub_key));
    db.user_metadata
        .insert(owner_pub_key, body.to_vec())
        .map_err(|e| {
            println!("[API] Error setting metadata in database: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    // println!("[API] Successfully set metadata Body {:#?}", body);
    Ok(StatusCode::OK)
}

// GET /metadata
async fn get_metadata(State(db): AppState, headers: HeaderMap) -> Result<Json<Value>, StatusCode> {
    // println!("[API] Received request for GET /metadata");
    let owner_pub_key = check_auth(&headers).await?;
    // println!("[API] Attempting to get metadata for public key: {:?}", hex::encode(owner_pub_key));
    let metadata = db.user_metadata.get(&owner_pub_key).map_err(|e| {
        println!("[API] Error getting metadata from database: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    // println!("[API] Successfully retrieved metadata");
    Ok(Json(
        serde_json::json!({ "encrypted_metadata": metadata.map(|m| hex::encode(m)) }),
    ))
}

async fn get_open_positions_for_address(
    State(db): AppState,
    Path(address_str): Path<String>,
) -> Result<Json<Value>, StatusCode> {
    let address: Address = address_str.parse().map_err(|_| StatusCode::BAD_REQUEST)?;

    // Convert address to padded bytes32 key
    let mut owner_id = [0u8; 32];
    owner_id[12..].copy_from_slice(address.as_bytes());

    let positions = db
        .get_open_positions(&owner_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({ "open_positions": positions })))
}

// GET /positions/history/:address
async fn get_historical_positions_for_address(
    State(db): AppState,
    Path(address_str): Path<String>,
    Query(pagination): Query<PaginationParams>,
) -> Result<Json<PaginatedResponse<HistoricalPosition>>, StatusCode> {
    let address: Address = address_str.parse().map_err(|_| StatusCode::BAD_REQUEST)?;

    let mut owner_id = [0u8; 32];
    owner_id[12..].copy_from_slice(address.as_bytes());

    let page_size = pagination.page_size.unwrap_or(20);
    let positions = db
        .get_historical_positions(&owner_id, pagination.cursor, page_size)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(positions))
}

// health route
async fn health() -> Result<Json<Value>, StatusCode> {
    Ok(Json(serde_json::json!({ "status": "ok" })))
}

pub async fn run_api_server(config: Arc<Config>, db: Arc<Database>) -> Result<()> {
    // println!("[API Server] Initializing API server...");
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);
    let app = Router::new()
        .route("/positions/{position_id}", get(get_position_by_id))
        .route(
            "/positions/open/{address}",
            get(get_open_positions_for_address),
        )
        .route(
            "/positions/history/{address}",
            get(get_historical_positions_for_address),
        )
        .route("/private/positions/open", get(get_private_open_positions))
        .route(
            "/private/positions/history",
            get(get_private_historical_positions),
        )
        .route("/private/notes/unspent", get(get_unspent_notes))
        .route("/private/metadata", get(get_metadata).post(set_metadata))
        .route("/health", get(health))
        .with_state(Arc::clone(&db))
        .layer(cors);

    // println!("[API Server] Binding to address: {}", &config.server_bind_address);
    let listener = tokio::net::TcpListener::bind(&config.server_bind_address).await?;
    // println!("[API Server] Listening on http://{}", &config.server_bind_address);
    axum::serve(listener, app).await?;
    Ok(())
}
