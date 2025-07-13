# --- Stage 1: The Builder ---
FROM rust:1-slim as builder

# Install build dependencies
RUN apt-get update && apt-get install -y build-essential pkg-config libssl-dev

WORKDIR /app

# Copy only the dependency files first to leverage Docker cache
COPY ./Cargo.lock ./Cargo.toml ./

# Create a dummy main.rs to build only the dependencies
RUN mkdir -p src && echo "fn main() {}" > src/main.rs
RUN cargo build --release

# Now copy the actual source code and build the final application
COPY ./src ./src
RUN cargo build --release

# --- Stage 2: The Final Image ---
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends libssl3 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy the compiled binary from the builder stage
COPY --from=builder /app/target/release/indexer-server /usr/local/bin/indexer-server

# Expose the port the API server will listen on
EXPOSE 3000

# The command to run the application
CMD ["indexer-server"]