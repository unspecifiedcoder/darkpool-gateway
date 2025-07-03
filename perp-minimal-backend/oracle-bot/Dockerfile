# File: perp-minimal-backend/oracle-bot/Dockerfile

# --- Stage 1: The Builder ---
# Use an official Rust slim image for a smaller base
FROM rust:1-slim as builder

# Set the working directory for the build
WORKDIR /app

# Copy ONLY the oracle-bot's source code into the build stage
# This makes the build cache more effective
COPY ./ .

# Build the oracle-bot in release mode for performance
RUN cargo build --release

# --- Stage 2: The Final Image ---
# Start from a minimal, lightweight Debian image
FROM debian:bullseye-slim

# Copy ONLY the compiled 'oracle-bot' binary from the 'builder' stage
# into a standard location in the final image's PATH.
COPY --from=builder /app/target/release/oracle-bot /usr/local/bin/oracle-bot

# Set the default command to run when the container starts.
# Railway can still override this, but it's good practice.
CMD ["oracle-bot"]