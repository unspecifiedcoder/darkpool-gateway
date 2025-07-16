// src/indexer.rs
use crate::{
    config::Config,
    database::Database,
    models::{Position, PositionStatus, UnspentNote},
};
use anyhow::Result;
use ethers::prelude::*;
use std::sync::Arc;
use tokio::time::{sleep, Duration};

abigen!(
    PrivacyProxy, "abi/PrivacyProxy.json";
    ClearingHouseV2, "abi/ClearingHouseV2.json";
    TokenPoolV2, "abi/TokenPool.json";
);

const BLOCK_CHUNK_SIZE: u64 = 2_000;
const DELAY_BETWEEN_CHUNKS_MS: u64 = 500; // 0.5 seconds

pub async fn run_indexer(
    config: Arc<Config>,
    db: Arc<Database>,
    provider: Arc<Provider<Ws>>,
) -> Result<()> {
    // Contract Instances
    // println!("Config {:#?}" , config);

    let proxy_address: Address = config.privacy_proxy_address.parse()?;
    let proxy_contract = PrivacyProxy::new(proxy_address, Arc::clone(&provider));
    let ch_address = proxy_contract.clearing_house().call().await?;
    let ch_contract = ClearingHouseV2::new(ch_address, Arc::clone(&provider));
    let tp_address: Address = config.token_pool_address.parse()?;
    let token_pool_contract = TokenPoolV2::new(tp_address, Arc::clone(&provider));
    let token_address: Address = config.token_address.parse()?;

    println!("[Indexer] Listening for events from all relevant contracts...");

    // Get the latest block on the chain
    let mut from_block = match provider.get_block_number().await {
        Ok(block_num) => block_num.as_u64(),
        Err(e) => {
            // This will print the *actual* root cause before crashing
            eprintln!(
                "[FATAL INDEXER ERROR] Failed to get latest block number: {}",
                e
            );
            // We still return the error to stop the process
            return Err(e.into());
        }
    };
    let latest_block = from_block.clone(); // Temp fix: Todo take from block from config

    while from_block <= latest_block {
        let to_block = (from_block + BLOCK_CHUNK_SIZE - 1).min(latest_block);
        println!(
            "[Indexer] Querying logs from block {} to {}",
            from_block, to_block
        );

        let pos_open_filter = proxy_contract
            .position_opened_filter()
            .from_block(from_block)
            .to_block(to_block);
        let pos_closed_filter = ch_contract
            .position_closed_filter()
            .from_block(from_block)
            .to_block(to_block);
        let pos_liquidated_filter = ch_contract
            .position_liquidated_filter()
            .from_block(from_block)
            .to_block(to_block);
        let note_created_filter = token_pool_contract
            .note_created_filter()
            .from_block(from_block)
            .to_block(to_block);
        let note_claimed_filter = token_pool_contract
            .note_claimed_filter()
            .from_block(from_block)
            .to_block(to_block);

        let (
            pos_opened_logs,
            pos_closed_logs,
            pos_liquidated_logs,
            note_created_logs,
            note_claimed_logs,
        ) = tokio::try_join!(
            pos_open_filter.query(),
            pos_closed_filter.query(),
            pos_liquidated_filter.query(),
            note_created_filter.query(),
            note_claimed_filter.query()
        )?;

        for log in pos_opened_logs {
            handle_position_opened(&db, log)?;
        }
        for log in pos_closed_logs {
            handle_position_closed(&db, log)?;
        }
        for log in pos_liquidated_logs {
            handle_position_liquidated(&db, log)?;
        }
        for log in note_created_logs {
            handle_note_created(&db, log, token_address).await?;
        }
        for log in note_claimed_logs {
            handle_note_claimed(&db, log)?;
        }

        from_block = to_block + 1;
        sleep(Duration::from_millis(DELAY_BETWEEN_CHUNKS_MS)).await;
    }

    let start_realtime_block = latest_block + 1;

    println!("[Indexer] Starting realtime sync");

    // Event Filters - Create filters with a longer lifetime
    let pos_open_filter = proxy_contract
        .position_opened_filter()
        .from_block(start_realtime_block);
    let pos_closed_filter = ch_contract
        .position_closed_filter()
        .from_block(start_realtime_block);
    let pos_liquidated_filter = ch_contract
        .position_liquidated_filter()
        .from_block(start_realtime_block);
    let note_created_filter = token_pool_contract
        .note_created_filter()
        .from_block(start_realtime_block);
    let note_claimed_filter = token_pool_contract
        .note_claimed_filter()
        .from_block(start_realtime_block);
    let public_pos_opened = ch_contract
        .position_opened_filter()
        .from_block(start_realtime_block);

    // Event Streams - Listen from block 0 to sync history
    let mut pos_open_stream = pos_open_filter.stream().await?;
    let mut pos_closed_stream = pos_closed_filter.stream().await?;
    let mut pos_liquidated_stream = pos_liquidated_filter.stream().await?;
    let mut note_created_stream = note_created_filter.stream().await?;
    let mut note_claimed_stream = note_claimed_filter.stream().await?;
    let mut public_pos_open_stream = public_pos_opened.stream().await?;

    loop {
        tokio::select! {
                Some(event) = pos_open_stream.next() => match event {
                    Ok(log) => { let _ = handle_position_opened(&db, log); },
                    Err(e) => eprintln!("[Indexer ERROR] PositionOpened stream error: {}", e),
                },
                Some(event) = pos_closed_stream.next() => match event {
                    Ok(log) => { let _ = handle_position_closed(&db, log); },
                    Err(e) => eprintln!("[Indexer ERROR] PositionClosed stream error: {}", e),
                },
                Some(event) = pos_liquidated_stream.next() => match event {
                    Ok(log) => { let _ = handle_position_liquidated(&db, log); },
                    Err(e) => eprintln!("[Indexer ERROR] PositionLiquidated stream error: {}", e),
                },
                Some(event) = note_created_stream.next() => match event {
                    Ok(log) => { let _ = handle_note_created(&db, log, token_address).await; },
                    Err(e) => eprintln!("[Indexer ERROR] NoteCreated stream error: {}", e),
                },
                Some(event) = note_claimed_stream.next() => match event {
                    Ok(log) => { let _ = handle_note_claimed(&db, log); },
                    Err(e) => eprintln!("[Indexer ERROR] NoteClaimed stream error: {}", e),
                },
                Some(event) = public_pos_open_stream.next() => match event {
                    Ok(log) => { let _ = handle_public_pos_opened(&db, log, proxy_address); },
                    Err(e) => eprintln!("[Indexer ERROR] NoteClaimed stream error: {}", e),
                }
        };
    }
}

fn handle_public_pos_opened(
    db: &Database,
    log: clearing_house_v2::PositionOpenedFilter,
    proxy_address: Address,
) -> Result<()> {
    if log.user == proxy_address {
        return Ok(());
    }

    println!(
        "[Indexer] Public PositionOpened for user {}: ID 0x{}",
        log.user,
        hex::encode(log.position_id)
    );
    let position = Position {
        position_id: format!("0x{}", hex::encode(log.position_id)),
        is_long: log.is_long,
        entry_price: log.entry_price.to_string(),
        margin: log.margin.to_string(),
        size: log.size.to_string(),
    };
    let mut owner_id = [0u8; 32];
    owner_id[12..].copy_from_slice(log.user.as_bytes());

    db.add_open_position(&owner_id, position).map_err(|e| {
        eprintln!(
            "[Indexer ERROR] Failed to add public open position to DB: {}",
            e
        );
        e
    })?;

    Ok(())
}

/// Handles a PositionOpened event.
fn handle_position_opened(db: &Database, log: privacy_proxy::PositionOpenedFilter) -> Result<()> {
    println!(
        "[Indexer] PositionOpened: ID 0x{}",
        hex::encode(log.position_id)
    );
    let position = Position {
        position_id: format!("0x{}", hex::encode(log.position_id)),
        is_long: log.is_long,
        entry_price: log.entry_price.to_string(),
        margin: log.margin.to_string(),
        size: log.size.to_string(),
    };
    db.add_open_position(&log.owner_pub_key, position)
        .map_err(|e: anyhow::Error| {
            eprintln!("[Indexer ERROR] Failed to add open position to DB: {}", e);
            e
        })?;
    Ok(())
}

/// Handles a PositionClosed event.
fn handle_position_closed(
    db: &Database,
    log: clearing_house_v2::PositionClosedFilter,
) -> Result<()> {
    println!(
        "[Indexer] PositionClosed: ID 0x{}",
        hex::encode(log.position_id)
    );
    let pnl_str = log.pnl.to_string();
    db.move_to_historical(&log.position_id, PositionStatus::Closed, pnl_str)
        .map_err(|e| {
            eprintln!("[Indexer ERROR] Failed to move position (closed): {}", e);
            e
        })?;
    Ok(())
}

/// Handles a PositionLiquidated event.
fn handle_position_liquidated(
    db: &Database,
    log: clearing_house_v2::PositionLiquidatedFilter,
) -> Result<()> {
    println!(
        "[Indexer] PositionLiquidated: ID 0x{}",
        hex::encode(log.position_id)
    );
    let pnl_str = "Liquidated".to_string();
    db.move_to_historical(&log.position_id, PositionStatus::Liquidated, pnl_str)
        .map_err(|e| {
            eprintln!(
                "[Indexer ERROR] Failed to move position (liquidated): {}",
                e
            );
            e
        })?;
    Ok(())
}

/// Handles a NoteCreated event.
async fn handle_note_created(
    db: &Database,
    log: token_pool_v2::NoteCreatedFilter,
    token_address: Address,
) -> Result<()> {
    let mut nonce_bytes = [0u8; 32];
    let note_nonce = U256::from(log.note_nonce);
    note_nonce.to_big_endian(&mut nonce_bytes);
    let address_bytes = token_address.as_bytes();
    let mut encoded_data = Vec::new();
    encoded_data.extend_from_slice(address_bytes);
    encoded_data.extend_from_slice(&nonce_bytes);

    let note_id = ethers::utils::keccak256(&encoded_data);
    println!(
        "[Indexer] NoteCreated: Note ID 0x{} with encoded data {:#?} where nonce is {}",
        hex::encode(note_id),
        hex::encode(encoded_data),
        log.note_nonce
    );
    let unspent_note = UnspentNote {
        note_id: format!("0x{}", hex::encode(note_id)),
        note: crate::models::Note {
            note_nonce: log.note_nonce.as_u64(),
            receiver_hash: format!("0x{}", hex::encode(log.receiver_hash)),
            value: log.amount.to_string(),
        },
    };
    println!("Note added {}" , hex::encode(note_id));
    db.add_unspent_note(&unspent_note).map_err(|e| {
        eprintln!("[Indexer ERROR] Failed to add unspent note: {}", e);
        e
    })?;
    Ok(())
}

/// Handles a NoteClaimed event.
fn handle_note_claimed(db: &Database, log: token_pool_v2::NoteClaimedFilter) -> Result<()> {
    println!("[Indexer] NoteClaimed: ID 0x{}", hex::encode(log.note_id));
    db.remove_unspent_note(&log.note_id).map_err(|e| {
        eprintln!("[Indexer ERROR] Failed to remove unspent note: {}", e);
        e
    })?;
    Ok(())
}
