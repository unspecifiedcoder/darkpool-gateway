FROM rust:1-slim as builder
RUN apt-get update && apt-get install -y build-essential pkg-config libssl-dev
WORKDIR /app
COPY ./ .
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libssl3 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/indexer-server /usr/local/bin/indexer-server
CMD ["indexer-server"]