use ethers::{
    abi::AbiDecode,
    prelude::*,
    providers::{Http, Provider},
    signers::{LocalWallet, Signer},
};
// NEW: Import HashMap for our new state management
use std::{collections::HashMap, env, str::FromStr, sync::Arc, time::Duration};
use tokio::sync::{Mutex, Semaphore};
use anyhow::Result;

abigen!(
    ClearingHouseV2, "abi/ClearingHouseV2.json";
    Oracle, "abi/Oracle.json";
);

struct Config {
    is_local_net: bool,
}

struct AppState {
    config: Config,
    active_positions: Mutex<HashMap<[u8; 32], Address>>,
    nonce_manager: Mutex<U256>,
}

const MAX_CONCURRENT_RPC_CALLS: usize = 5;

#[tokio::main]
async fn main() -> Result<()> {
    // --- NEW: Parse CLI arguments to determine run mode ---
    let args: Vec<String> = env::args().collect();
    let is_local_net = args.contains(&"--local".to_string());

    if is_local_net {
        println!("🚀 Running in --local mode: Transactions will be sent sequentially.");
    } else {
        println!("🚀 Running in production mode: Transactions will be sent concurrently.");
    }



    dotenv::dotenv().ok();
    let rpc_url = env::var("RPC_URL").expect("RPC_URL must be set");
    let private_key = env::var("LIQUIDATOR_PRIVATE_KEY").expect("LIQUIDATOR_PRIVATE_KEY must be set");
    let clearing_house_address_str = env::var("CLEARING_HOUSE_CONTRACT_ADDRESS").expect("CLEARING_HOUSE_CONTRACT_ADDRESS must be set");
    let oracle_address_str = env::var("ORACLE_CONTRACT_ADDRESS").expect("ORACLE_CONTRACT_ADDRESS must be set");

    let provider = Provider::<Http>::try_from(&rpc_url)?;
    let chain_id = provider.get_chainid().await?.as_u64();
    let wallet = LocalWallet::from_str(&private_key)?.with_chain_id(chain_id);
    let client = Arc::new(SignerMiddleware::new(provider.clone(), wallet.clone())); // Clone provider for resync

    let clearing_house_address: Address = clearing_house_address_str.parse()?;
    let clearing_house = ClearingHouseV2::new(clearing_house_address, Arc::clone(&client));
    
    let oracle_address: Address = oracle_address_str.parse()?;
    let oracle = Oracle::new(oracle_address, Arc::clone(&client));

    let initial_nonce = client.get_transaction_count(wallet.address(), None).await?;

    let app_state = Arc::new(AppState {
        config: Config { is_local_net },
        active_positions: Mutex::new(HashMap::new()),
        nonce_manager: Mutex::new(initial_nonce),
    });

    println!("✅ V2 Liquidation Bot Started");
    println!("-> Liquidator Account: {:#x}", client.address());
    println!("-> Initial Nonce: {}", initial_nonce);
    
    // --- Event Listening ---
    let position_listener_handle = tokio::spawn(listen_for_position_changes(Arc::clone(&app_state), clearing_house.clone()));
    let liquidation_trigger_handle = tokio::spawn(listen_for_price_changes(Arc::clone(&app_state), clearing_house.clone(), oracle.clone()));
    
    
    let nonce_resync_handle = tokio::spawn(resync_nonce(Arc::clone(&app_state), provider, wallet.address()));
    
    tokio::try_join!(position_listener_handle, liquidation_trigger_handle, nonce_resync_handle)?;
    Ok(())
}


/// V2: The core logic now iterates over position IDs
async fn check_and_liquidate_positions(
    state: Arc<AppState>,
    clearing_house: ClearingHouseV2<SignerMiddleware<Provider<Http>, LocalWallet>>,
) {
    let positions_to_check: Vec<[u8; 32]> = state.active_positions.lock().await.keys().cloned().collect();
    if positions_to_check.is_empty() { return; }
    println!("Checking {} active position(s)...", positions_to_check.len());

    // --- Conditional Logic ---
    if state.config.is_local_net {
        // --- Sequential execution for local Hardhat node ---
        for position_id in positions_to_check {
            let pnl_result = clearing_house.calculate_pnl(position_id).call().await;
            if let Ok((_pnl, is_solvent)) = pnl_result {
                if !is_solvent {
                    println!("🔥 [SEQUENTIAL] Position ID {:?} is INSOLVENT! Attempting liquidation...", hex::encode(position_id));
                    // For local automine, we don't need the complex nonce manager. 
                    // The SignerMiddleware handles it correctly for sequential calls.
                    let tx = clearing_house.liquidate(position_id);
                    // We wait for each one to complete before starting the next.
                    match tx.send().await {
                        Ok(pending) => {
                            let _ = pending.await; // Wait for confirmation
                            println!("✅ [SEQUENTIAL] Liquidation tx for {:?} confirmed or failed.", hex::encode(position_id));
                        },
                        Err(e) => eprintln!("[ERROR] [SEQUENTIAL] Failed to send tx for {:?}: {}", hex::encode(position_id), e)
                    };
                };
            }
        }
    } else {
        // --- Concurrent execution for public networks ---
        let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_RPC_CALLS));
        let mut tasks = Vec::new();

        for position_id in positions_to_check {
            let clearing_house_clone = clearing_house.clone();
            let semaphore_clone = Arc::clone(&semaphore);
            let state_clone = Arc::clone(&state);

            tasks.push(tokio::spawn(async move {
                let _permit = semaphore_clone.acquire().await.unwrap();
                let pnl_result = clearing_house_clone.calculate_pnl(position_id).call().await;
                if let Ok((_pnl, is_solvent)) = pnl_result {
                    if !is_solvent {
                        println!("🔥 [CONCURRENT] Position ID {:?} is INSOLVENT! Attempting liquidation...", hex::encode(position_id));
                        send_liquidation_tx(state_clone, clearing_house_clone, position_id).await;
                    }
                }
            }));
        }
        futures::future::join_all(tasks).await;
    }
    println!("✅ Finished checking all positions.");
}

async fn send_liquidation_tx(
    state: Arc<AppState>,
    clearing_house: ClearingHouseV2<SignerMiddleware<Provider<Http>, LocalWallet>>,
    position_id: [u8; 32]
) {
    let nonce_to_use = {
        let mut nonce_lock = state.nonce_manager.lock().await;
        let nonce = *nonce_lock;
        *nonce_lock += U256::one();
        nonce
    };

    let mut tx = clearing_house.liquidate(position_id);
    tx.tx.set_nonce(nonce_to_use);
    
    match tx.send().await {
        Ok(pending_tx) => {
            if let Ok(Some(receipt)) = pending_tx.await {
                println!("✅ SUCCESS: Liquidated {:?}. Tx: {:#x}", hex::encode(position_id), receipt.transaction_hash);
            }
        },
        Err(e) => {
            let decoded_error = decode_contract_error(e);
            eprintln!("[ERROR] Failed to send tx for {:?}: {}", hex::encode(position_id), decoded_error);
        }
    };
}

async fn resync_nonce(state: Arc<AppState>, provider: Provider<Http>, wallet_address: Address) -> Result<()> {
    // This is less critical for local mode but good to keep for production
    if !state.config.is_local_net {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            if let Ok(on_chain_nonce) = provider.get_transaction_count(wallet_address, None).await {
                let mut nonce_lock = state.nonce_manager.lock().await;
                if *nonce_lock != on_chain_nonce {
                    println!("[RESYNC] Nonce out of sync! Local: {}, On-chain: {}. Correcting.", *nonce_lock, on_chain_nonce);
                    *nonce_lock = on_chain_nonce;
                }
            }
        }
    }
    Ok(())
}



// V2: Updated to handle new event structures and store positionId->owner
async fn listen_for_position_changes(
    state: Arc<AppState>,
    clearing_house: ClearingHouseV2<SignerMiddleware<Provider<Http>, LocalWallet>>,
) -> Result<()> {
    println!("👂 Listening for V2 position management events...");
    let events = clearing_house.events().from_block(BlockNumber::Latest);
    let mut stream = events.stream().await?;
    
    while let Some(Ok(log)) = stream.next().await {
        let mut positions = state.active_positions.lock().await;
        match log {
            ClearingHouseV2Events::PositionOpenedFilter(f) => {
                positions.insert(f.position_id, f.user);
                println!("➕ Added position: ID={:?}, Owner={}", hex::encode(f.position_id), f.user);
            }
            ClearingHouseV2Events::PositionClosedFilter(f) => {
                positions.remove(&f.position_id);
                println!("➖ Removed (closed) position: ID={:?}", hex::encode(f.position_id));
            }
            ClearingHouseV2Events::PositionLiquidatedFilter(f) => {
                positions.remove(&f.position_id);
                println!("➖ Removed (liquidated) position: ID={:?}", hex::encode(f.position_id));
            }
            _ => {}
        }
    }
    Ok(())
}


fn decode_contract_error(e: ContractError<SignerMiddleware<Provider<Http>, LocalWallet>>) -> String {
    if let ContractError::Revert(data) = e {
        if let Ok(decoded) = PositionNotLiquidatable::decode(data.clone()) { return format!("Revert: PositionNotLiquidatable {:?}", decoded); }
        if let Ok(decoded) = PositionNotFound::decode(data.clone()) { return format!("Revert: PositionNotFound {:?}", decoded); }
        if let Ok(decoded) = NotPositionOwner::decode(data.clone()) { return format!("Revert: NotPositionOwner {:?}", decoded); }
        return format!("Unknown Custom Revert: 0x{}", hex::encode(data));
    }
    e.to_string()
}

async fn listen_for_price_changes(
    state: Arc<AppState>,
    clearing_house: ClearingHouseV2<SignerMiddleware<Provider<Http>, LocalWallet>>,
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