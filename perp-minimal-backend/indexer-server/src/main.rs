mod api;
mod config;
mod database;
mod indexer;
mod models;

use anyhow::Result;
use config::Config;
use database::Database;
use ethers::providers::{Middleware, Provider, Ws};
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<()> {
    // 1. Load configuration
    let config = Arc::new(Config::from_env()?);
    println!("✅ Configuration loaded.");

    // 2. Initialize the database
    let db = Arc::new(Database::new(&config.db_path)?);
    println!("✅ Database connected at: {}", &config.db_path);

    // 3. Initialize Ethereum provider
    let provider = Arc::new(Provider::<Ws>::connect(&config.rpc_url).await?);
    println!("✅ Ethereum provider connected.");

    // log block number
    println!("config.rpc_url {}", config.rpc_url);
    let _latest_block = match provider.get_block_number().await {
        Ok(block_num) => block_num.as_u64(),
        Err(e) => {
            eprintln!(
                "[FATAL INDEXER ERROR] Failed to get latest block number: {}",
                e
            );
            return Err(e.into());
        }
    };

    // 4. Start the two main services concurrently
    println!("🚀 Starting API Server and Blockchain Indexer...");

    let api_handle = tokio::spawn(api::run_api_server(Arc::clone(&config), Arc::clone(&db)));
    let indexer_handle = tokio::spawn(indexer::run_indexer(
        Arc::clone(&config),
        Arc::clone(&db),
        Arc::clone(&provider),
    ));

    // Keep the application running and handle exits gracefully
    tokio::select! {
        result = api_handle => {
            eprintln!("[FATAL] API server has exited.");
            result??;
        }
        result = indexer_handle => {
            eprintln!("[FATAL] Blockchain indexer has exited.");
            result??;
        }
    };

    Ok(())
}
