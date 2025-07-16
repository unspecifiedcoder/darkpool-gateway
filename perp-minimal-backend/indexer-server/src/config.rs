use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    pub rpc_url: String,
    pub privacy_proxy_address: String,
    pub token_pool_address: String,
    pub db_path: String,
    pub server_bind_address: String,
    pub token_address: String,
}

impl Config {
    pub fn from_env() -> Result<Self, anyhow::Error> {
        dotenv::dotenv().ok();
        Ok(Self {
            rpc_url: env::var("RPC_URL")?,
            privacy_proxy_address: env::var("PRIVACY_PROXY_ADDRESS")?,
            token_pool_address: env::var("TOKEN_POOL_ADDRESS")?,
            db_path: env::var("DB_PATH").unwrap_or_else(|_| "./db".to_string()),
            server_bind_address: env::var("SERVER_BIND_ADDRESS")
                .unwrap_or_else(|_| "0.0.0.0:3000".to_string()),
            token_address: env::var("TOKEN_ADDRESS").expect("Token address not set"),
        })
    }
}
