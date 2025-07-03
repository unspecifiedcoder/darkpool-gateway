# File: perp-minimal-backend/liquidation-bot/Dockerfile

# --- Stage 1: The Builder ---
FROM rust:1-slim as builder
RUN apt-get update && apt-get install -y pkg-config libssl-dev
WORKDIR /app



# Copy ONLY the liquidation-bot's source code
COPY ./ .

# Build the liquidation-bot in release mode
RUN cargo build --release

# --- Stage 2: The Final Image ---
FROM debian:bullseye-slim

# Copy ONLY the compiled 'liquidation-bot' binary from the 'builder' stage
COPY --from=builder /app/target/release/liquidation-bot /usr/local/bin/liquidation-bot

# Set the default command to run when the container starts.
CMD ["liquidation-bot"]