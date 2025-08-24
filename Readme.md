# Xythum Darkpool Gateway

**A Privacy-Preserving Interaction Layer for Decentralized Finance**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Hardhat](https://hardhat.org/hardhat-logo.svg)](https://hardhat.org/)
[![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![Rust](https://img.shields.io/badge/rust-%23000000.svg?style=for-the-badge&logo=rust&logoColor=white)](https://www.rust-lang.org/)

## 1. Vision: DeFi Without Compromise

**Xythum Darkpool Gateway** is an experimental protocol designed to solve this problem, it is a **privacy-preserving interaction layer** that can be placed in front of *any* DeFi protocol, enabling users to engage with complex financial applications without revealing their primary on-chain identity.

The core mission of this project is to build a generic **Privacy Gateway**, a system of smart contracts and off-chain services that anonymizes DeFi interactions. Users onboard into the Xythum Darkpool once, creating a private, ZK-shielded balance. From that point on, they can interact with integrated protocols through a proxy, proving ownership of their funds cryptographically without ever linking their actions back to their original deposit address.

To demonstrate the power and practicality of this gateway, we have built a fully-featured **Perpetual Futures DEX** as the first integrated application. This allows us to showcase the seamless user experience of switching between public (transparent) and private (anonymous) trading.

## 2. Core Concepts

Xythum's architecture is built on a foundation of cutting-edge cryptography and a clear separation of concerns.

### The Dark Pool (`TokenPoolV2`)
The entry point to the system. It is a ZK-powered privacy pool, inspired by protocols like Tornado Cash but designed for general-purpose asset management.
*   **Commitments:** When a user deposits funds, they create a "commitment" on-chain, which is a hash of their deposit amount, a secret, and a nullifier. This commitment is added as a leaf to a Merkle tree.
*   **Secrets & Nullifiers:** A user's core identity within the dark pool is a **secret**, deterministically derived by signing a message with their standard EOA wallet. This secret is never exposed on-chain. To prevent double-spending, each action (like a withdrawal or transfer) requires a unique **nullifier**, which is also derived from the secret and a nonce.
*   **ZK-SNARKs:** All actions that involve moving or proving ownership of funds within the pool are verified by on-chain ZK-SNARK verifiers. A user generates a proof client-side in their browser, proving they own a valid, unspent commitment in the Merkle tree without revealing which one.

### The Privacy Gateway (`PrivacyProxy.sol`)
This is the heart of the system. It is a smart contract that acts as a universal, anonymous trading account for all private users.
*   **The Shield:** The `PrivacyProxy` holds all collateral and opens all positions on the integrated DeFi protocol (our Perpetuals DEX). From the DEX's perspective, it appears as a single, high-volume trader.
*   **Internal State Management:** The proxy internally maps on-chain positions back to a user's "public key" (a hash derived from their secret).
*   **Signature-Based Authorization:** To perform any action (like opening a position or withdrawing collateral), a user must sign a message with their **dark pool secret**. This signature is verified by the `PrivacyProxy` on-chain, proving ownership without revealing the secret itself.

### The Off-Chain Stack (Indexer + Server)
A high-performance Rust backend that makes the private user experience seamless and efficient.
*   **Indexer:** Listens to all on-chain events from the `TokenPoolV2`, `PrivacyProxy`, and `ClearingHouseV2` contracts. It builds a persistent, queryable database of all private and public positions, notes, and historical trades.
*   **Server:** Exposes a secure API for the frontend. Users authenticate with the server by signing messages with their dark pool secret. The server then provides them with their private state, such as their unspent notes, active position IDs, and encrypted metadata (like their latest nullifier nonce).

## 3. The Demo Application: A Perpetual Futures DEX

To showcase the gateway's capabilities, we've integrated a fully-featured perpetuals DEX.

### Key Features:
*   **Dual-Mode Trading:** A simple toggle in the UI allows users to switch between:
    *   **Public Mode:** Trading directly from their EOA wallet. All positions are publicly visible on the `ClearingHouseV2` contract and tied to their address.
    *   **Private Mode:** Trading through the `PrivacyProxy`. Positions are opened and managed anonymously. The user's EOA is never linked to their trading activity.
*   **Complete Functionality:** Users can deposit/withdraw collateral, open/close long and short positions, and manage margin in both modes.
*   **Position Explorer:** A public-facing explorer where anyone can look up a `positionId` and see its details. The explorer clearly indicates whether a position is "Public" or "Private" based on whether its owner is an EOA or the `PrivacyProxy` contract.

This dual-mode functionality provides a powerful, tangible demonstration of the privacy gateway's value proposition.

5. Getting Started

This repository is a monorepo containing all components of the Xythum stack.

*   `/contracts`: The Solidity smart contracts.
*   `/circuits`: The Noir ZK circuits (assumed).
*   `/perp-minimal-backend`: The Rust off-chain services, including the `indexer-server` and bots.
*   `/frontend`: The React/Vite user interface.


Todos

- [ ] claim / withdraw Many
- [ ] Relayer Network
- [ ] Governance 
- [ ] encrypted state management over DA.
