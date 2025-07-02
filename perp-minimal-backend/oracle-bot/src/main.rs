use ethers::{
    prelude::*,
    providers::{Provider, Ws},
    signers::{LocalWallet, Signer},
    types::U256,
};
use serde::Deserialize;
use std::{env, str::FromStr, sync::Arc, time::Duration};
use anyhow::Result;

// Generate the an `Oracle` struct with all the type-safe bindings from the ABI.
// This is a build-time macro that reads the ABI file.
abigen!(Oracle, "abi/Oracle.json");

// A struct to deserialize the JSON response from the Binance API
#[derive(Debug, Deserialize)]
struct BinancePrice {
    symbol: String,
    price: String,
}

/// Fetches the current BTC/USDT price from the Binance API.
async fn fetch_btc_price(client: &reqwest::Client) -> Result<f64> {
    let response = client
        .get("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT")
        .send()
        .await?
        .error_for_status()? // This will raise an error for non-200 status codes
        .json::<BinancePrice>()
        .await?;

    // Parse the price string from the response into a float.
    let price_f64 = response.price.parse::<f64>()?;
    Ok(price_f64)
}

/// Converts a floating-point price into a U256 integer with 18 decimals,
/// which is the format our smart contract expects.
fn to_u256_price(price: f64) -> U256 {
    // We multiply by 10^18 to scale the price.
    // Note: For financial applications requiring extreme precision, using a dedicated
    // decimal library would be better than floating-point math. For this use case,
    // f64 is sufficient.
    let scaled_price = price * 1e18;
    U256::from(scaled_price as u128)
}

#[tokio::main]
async fn main() -> Result<()> {
    // Load configuration from the .env file
    dotenv::dotenv().ok();
    let rpc_url = env::var("RPC_URL").expect("RPC_URL must be set");
    let private_key = env::var("PRIVATE_KEY").expect("PRIVATE_KEY must be set");
    let contract_address = env::var("ORACLE_CONTRACT_ADDRESS").expect("ORACLE_CONTRACT_ADDRESS must be set");
    let price_threshold: f64 = env::var("PRICE_CHANGE_THRESHOLD")
        .expect("PRICE_CHANGE_THRESHOLD must be set")
        .parse()?;

    // Set up the Ethereum provider and client.
    // Using a WebSocket provider is best for long-running applications.
    let provider = Provider::<Ws>::connect(&rpc_url).await?;
    let chain_id = provider.get_chainid().await?.as_u64();
    
    // Create a signer instance from our private key.
    let wallet = LocalWallet::from_str(&private_key)?.with_chain_id(chain_id);

    // Create a client instance to sign and send transactions.
    // Arc is a thread-safe reference-counting pointer, which allows us to share
    // the client between the contract instance and our main logic safely.
    let client = Arc::new(SignerMiddleware::new(provider, wallet));

    // Create a type-safe instance of our Oracle contract.
    let oracle_address: Address = contract_address.parse()?;
    let oracle_contract = Oracle::new(oracle_address, Arc::clone(&client));

    println!("Oracle Bot Started...");
    println!("-> Oracle Contract: {}", contract_address);
    println!("-> Updater Account: {:#x}", client.address());
    println!("-> Price Update Threshold: {}%", price_threshold * 100.0);

    // This will hold the last price we successfully sent to the blockchain.
    // We use it as a cache to avoid sending redundant transactions.
    let mut last_sent_price: Option<U256> = None;
    let http_client = reqwest::Client::new();

    // Main application loop
    loop {
        println!("\n--- New Tick ---");
        
        // 1. Fetch Price from Binance
        let current_price_f64 = match fetch_btc_price(&http_client).await {
            Ok(price) => {
                println!("Fetched price from Binance: ${:.2}", price);
                price
            },
            Err(e) => {
                eprintln!("[ERROR] Failed to fetch price from Binance: {}", e);
                // Wait before retrying to avoid spamming the API on failure
                tokio::time::sleep(Duration::from_secs(10)).await;
                continue;
            }
        };

        let new_price_u256 = to_u256_price(current_price_f64);

        // 2. Caching and Threshold Logic
        if let Some(last_price) = last_sent_price {
            let last_f64 = last_price.as_u128() as f64 / 1e18;
            let change = ((current_price_f64 - last_f64) / last_f64).abs();

            if change < price_threshold {
                println!("Price change ({:.4}%) is within the threshold. No update needed.", change * 100.0);
                // Wait for the next 10-second interval
                tokio::time::sleep(Duration::from_secs(10)).await;
                continue;
            }
            println!("Price change of {:.4}% detected. Submitting update...", change * 100.0);
        } else {
            println!("No last price cached. Submitting first price update...");
        }

        // 3. Send Transaction to the Smart Contract
        println!("Submitting price {:.18} to the contract...", new_price_u256);

        let call = oracle_contract.set_price(new_price_u256);
        match call.send().await {
            Ok(pending_tx) => {
                println!("Transaction sent. Waiting for confirmation...");
                match pending_tx.await {
                    Ok(Some(receipt)) => {
                        println!("✅ Transaction confirmed! Hash: {:#x}", receipt.transaction_hash);
                        // Update our cache with the new price
                        last_sent_price = Some(new_price_u256);
                    }
                    Ok(None) => {
                        eprintln!("[ERROR] Transaction dropped from mempool.");
                    }
                    Err(e) => {
                        eprintln!("[ERROR] Failed to confirm transaction: {}", e);
                    }
                }
            }
            Err(e) => {
                eprintln!("[ERROR] Failed to send transaction: {}", e);
            }
        }
        
        // 4. Wait for the next cycle
        tokio::time::sleep(Duration::from_secs(10)).await;
    }
}