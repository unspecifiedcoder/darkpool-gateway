// --- Position Models ---

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PositionStatus {
    Open,
    Closed,
    Liquidated,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub position_id: String, 
    pub is_long: bool,
    pub entry_price: String, // U256 as string
    pub margin: String,      // U256 as string
    pub size: String,        // U256 as string
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoricalPosition {
    #[serde(flatten)]
    pub position: Position,
    pub status: PositionStatus,
    pub final_pnl: String, // i256 as string
}

// --- Note Models ---

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Note {
    pub note_nonce: u64,
    pub receiver_hash: String, 
    pub value: String,         // U256 as string
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnspentNote {
    pub note_id: String, 
    #[serde(flatten)]
    pub note: Note,
}

// --- Metadata Model ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserMetadata {
    pub last_used_nullifier_nonce: u64,
}

// --- API Models ---

#[derive(Debug, Serialize)]
pub struct PaginatedResponse<T> {
    pub items: Vec<T>,
    pub has_more: bool,
    pub next_cursor: Option<String>,
}
