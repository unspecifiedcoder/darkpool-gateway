use ethers::{
    abi::AbiDecode,
    prelude::*,
    providers::{Http, Provider},
    signers::{LocalWallet, Signer},
};
use std::{collections::HashSet, env, str::FromStr, sync::Arc};
use tokio::sync::{Mutex, Semaphore};
use anyhow::Result;

// Generate type-safe bindings for both contracts
abigen!(
    ClearingHouse, "abi/ClearingHouse.json";
    Oracle, "abi/Oracle.json";
);

// A shared state for our application
struct AppState {
    active_positions: Mutex<HashSet<Address>>,
    nonce_manager: Mutex<U256>,
}

// Configuration for rate limiting
const MAX_CONCURRENT_RPC_CALLS: usize = 5;

#[tokio::main]
async fn main() -> Result<()> {
    // --- SETUP (Identical to before) ---
    dotenv::dotenv().ok();
    let rpc_url = env::var("RPC_URL").expect("RPC_URL must be set");
    let private_key = env::var("LIQUIDATOR_PRIVATE_KEY").expect("LIQUIDATOR_PRIVATE_KEY must be set");
    let clearing_house_address_str = env::var("CLEARING_HOUSE_CONTRACT_ADDRESS").expect("CLEARING_HOUSE_CONTRACT_ADDRESS must be set");
    let oracle_address_str = env::var("ORACLE_CONTRACT_ADDRESS").expect("ORACLE_CONTRACT_ADDRESS must be set");

    let provider = Provider::<Http>::try_from(&rpc_url)?;
    let chain_id = provider.get_chainid().await?.as_u64();
    let wallet = LocalWallet::from_str(&private_key)?.with_chain_id(chain_id);
    let client = Arc::new(SignerMiddleware::new(provider, wallet.clone()));

    let clearing_house_address: Address = clearing_house_address_str.parse()?;
    let clearing_house = ClearingHouse::new(clearing_house_address, Arc::clone(&client));
    
    let oracle_address: Address = oracle_address_str.parse()?;
    let oracle = Oracle::new(oracle_address, Arc::clone(&client));

    let initial_nonce = client.get_transaction_count(wallet.address(), None).await?;


    let app_state = Arc::new(AppState {
        active_positions: Mutex::new(HashSet::new()),
        nonce_manager: Mutex::new(initial_nonce),
    });

    println!("✅ Liquidation Bot Started");
    println!("-> Liquidator Account: {:#x}", client.address());
    println!("-> Max Concurrent RPC Calls: {}", MAX_CONCURRENT_RPC_CALLS);
    println!("-> Initial Nonce: {}", initial_nonce);

    
    println!("⏳ Syncing historical state...");
    sync_historical_state(Arc::clone(&app_state), &clearing_house).await?;
    println!("✅ Historical state synced.");
    
    let position_listener_handle = tokio::spawn(listen_for_position_changes(Arc::clone(&app_state), clearing_house.clone()));
    let liquidation_trigger_handle = tokio::spawn(listen_for_price_changes(Arc::clone(&app_state), clearing_house.clone(), oracle.clone()));
    
    tokio::try_join!(position_listener_handle, liquidation_trigger_handle)?;

    Ok(())
}


/// The core logic: check all active positions and fire off liquidations concurrently.
async fn check_and_liquidate_positions(
    state: Arc<AppState>,
    clearing_house: ClearingHouse<SignerMiddleware<Provider<Http>, LocalWallet>>,
) {
    let positions_to_check = state.active_positions.lock().await.clone();
    
    if positions_to_check.is_empty() {
        println!("No active positions to check.");
        return;
    }

    println!("Checking {} active position(s)...", positions_to_check.len());

    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_RPC_CALLS));
    let mut tasks = Vec::new();

    for user_address in positions_to_check {
        let clearing_house_clone = clearing_house.clone();
        let semaphore_clone = Arc::clone(&semaphore);
        let state_clone = Arc::clone(&state);

        tasks.push(tokio::spawn(async move {
            let _permit = semaphore_clone.acquire().await.unwrap();
            let pnl_result = clearing_house_clone.calculate_pnl(user_address).call().await;
            
            match pnl_result {
                Ok((_pnl, is_solvent)) => {
                    if !is_solvent {
                        println!("🔥 Position for {} is INSOLVENT! Attempting liquidation...", user_address);

                        let nonce_to_use = {
                            let mut nonce_lock = state_clone.nonce_manager.lock().await;
                            let nonce = *nonce_lock;
                            *nonce_lock += U256::one(); // Increment for the next task
                            nonce
                        };
                        println!("   -> Using nonce {} for user {}", nonce_to_use, user_address);
                        
                        let mut tx = clearing_house_clone.liquidate(user_address);
                        tx.tx.set_nonce(nonce_to_use);
                        
                        let send_result = tx.send().await;

                        match send_result {
                            Ok(pending_tx) => {
                                match pending_tx.await {
                                    Ok(Some(receipt)) => {
                                        println!("✅ Successfully liquidated position for {}. Tx: {:#x}", user_address, receipt.transaction_hash);
                                    }
                                    Ok(None) => eprintln!("[ERROR] Liquidation tx for {} was dropped from mempool.", user_address),
                                    Err(e) => eprintln!("[ERROR] Liquidation for {} failed on-chain: {}", user_address, e),
                                }
                            },
                            Err(e) => {
                                // --- FIX: Decode and print the custom error ---
                                let decoded_error = decode_contract_error(e);
                                eprintln!("[ERROR] Failed to send liquidation tx for {}: {}", user_address, decoded_error);
                            }
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[ERROR] Could not check PnL for user {}: {}", user_address, e);
                }
            }
        }));
    }

    futures::future::join_all(tasks).await;
    println!("✅ Finished checking all positions.");
}


// --- NEW: Function to decode custom errors ---
fn decode_contract_error(e: ContractError<SignerMiddleware<Provider<Http>, LocalWallet>>) -> String {
    if let ContractError::Revert(data) = e {
        if let Ok(decoded) = PositionNotLiquidatable::decode(data.clone()) {
            return format!("Contract Revert: PositionNotLiquidatable ({:?})", decoded);
        }
        if let Ok(decoded) = PositionNotFound::decode(data.clone()) {
            return format!("Contract Revert: PositionNotFound ({:?})", decoded);
        }
        // Add more custom errors here as needed
        return format!("Contract Revert with unknown custom error. Data: 0x{}", hex::encode(data));
    }
    // Fallback for other error types
    e.to_string()
}

// Unchanged functions from here down...
async fn listen_for_position_changes(
    state: Arc<AppState>,
    clearing_house: ClearingHouse<SignerMiddleware<Provider<Http>, LocalWallet>>,
) -> Result<()> {
    println!("👂 Listening for position management events...");
    let events = clearing_house.events().from_block(BlockNumber::Latest);
    let mut stream = events.stream().await?;
    
    while let Some(Ok(log)) = stream.next().await {
        let mut positions = state.active_positions.lock().await;
        match log {
            ClearingHouseEvents::PositionOpenedFilter(f) => {
                positions.insert(f.user);
                println!("➕ Added position for user: {:#x}", f.user);
            }
            ClearingHouseEvents::PositionClosedFilter(f) => {
                positions.remove(&f.user);
                println!("➖ Removed position for user: {:#x}", f.user);
            }
            ClearingHouseEvents::PositionLiquidatedFilter(f) => {
                positions.remove(&f.user);
                println!("➖ Removed liquidated position for user: {:#x}", f.user);
            }
            _ => {}
        }
    }
    Ok(())
}

async fn listen_for_price_changes(
    state: Arc<AppState>,
    clearing_house: ClearingHouse<SignerMiddleware<Provider<Http>, LocalWallet>>,
    oracle: Oracle<SignerMiddleware<Provider<Http>, LocalWallet>>,
) -> Result<()> {
    println!("👂 Listening for oracle price updates...");
    let events = oracle.events().from_block(BlockNumber::Latest);
    let mut stream = events.stream().await?;

    while let Some(Ok(_)) = stream.next().await {
        println!("\n🚨 Oracle price updated! Checking for liquidatable positions...");
        check_and_liquidate_positions(Arc::clone(&state), clearing_house.clone()).await;
    }
    Ok(())
}

async fn sync_historical_state(state: Arc<AppState>, clearing_house: &ClearingHouse<SignerMiddleware<Provider<Http>, LocalWallet>>) -> Result<()> {
    let mut positions = state.active_positions.lock().await;

    let open_events = clearing_house.position_opened_filter().query().await?;
    for event in &open_events {
        positions.insert(event.user);
    }
    
    let close_events = clearing_house.position_closed_filter().query().await?;
    for event in &close_events {
        positions.remove(&event.user);
    }

    let liquidated_events = clearing_house.position_liquidated_filter().query().await?;
    for event in &liquidated_events {
        positions.remove(&event.user);
    }

    println!("-> Found {} opened, {} closed, {} liquidated events.", open_events.len(), close_events.len(), liquidated_events.len());
    println!("-> Resulting in {} currently active positions.", positions.len());

    Ok(())
}