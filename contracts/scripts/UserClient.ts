
import { ethers } from "hardhat";
import axios from "axios";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Wallet } from "ethers";
import { poseidon2Hash } from "@aztec/foundation/crypto";
import { Fr } from "@aztec/foundation/fields";

// --- CONFIG & TYPES ---
const INDEXER_API_URL = "http://localhost:3000";

export interface UserMetadata {
  last_used_nullifier_nonce: number;
  // This represents a user's single, consolidated private balance in the dark pool.
  commitment_info: {
    value: string;
    leafIndex: number;
  } | null; // Null if they have no funds in the pool.
}
interface ApiPosition {
    position_id: string;
    is_long: boolean;
    entry_price: string;
    margin: string;
    size: string;
  }
  interface ApiNote {
    note_id: string;
    note: { note_nonce: number; value: string; receiver_hash: string };
  }
// =================================================================
// == USER CLIENT CLASS: MIMICS A REAL FRONTEND APPLICATION
// =================================================================
export class UserClient {
  public signer: HardhatEthersSigner;
  public secretWallet: Wallet;
  public pubKey: string;
  public receiverSecret: Fr;
  public receiverHash: Fr;
  currentMetadata: UserMetadata;

  private constructor(signer: HardhatEthersSigner, privateKeyForSecret: string) {
    this.signer = signer;
    this.secretWallet = new Wallet(privateKeyForSecret);
    this.pubKey = ethers.solidityPackedKeccak256(["address"], [this.secretWallet.address]);
    this.receiverSecret = Fr.random();
    this.receiverHash = Fr.ZERO;
    this.currentMetadata = { last_used_nullifier_nonce: 0, commitment_info: null };
  }

  static async create(signer: HardhatEthersSigner): Promise<UserClient> {
    const signature = await signer.signMessage("DarkPerps Login Secret v1");
    const privateKey = ethers.keccak256(signature);
    const client = new UserClient(signer, privateKey);
    client.receiverHash = await poseidon2Hash([client.receiverSecret]);
    return client;
  }

  private encrypt(data: UserMetadata): string {
    const json = JSON.stringify(data);
    return Buffer.from(json).toString('base64');
  }

  private decrypt(blob: string): UserMetadata {
    const json = Buffer.from(blob, 'base64').toString('utf-8');
    return JSON.parse(json);
  }

  private async getAuthHeaders(message: string): Promise<any> {
    const signature = await this.secretWallet.signMessage(message);
    return { "X-Message": message, "X-Signature": signature };
  }

  async fetchAndSetMetadata(): Promise<void> {
    console.log(`    - Client: Fetching latest metadata for pubKey ...${this.pubKey.slice(-6)}`);
    try {
      const headers = await this.getAuthHeaders("GET /metadata");
      const { data } = await axios.get<{ encrypted_metadata: string | null }>(`${INDEXER_API_URL}/metadata`, { headers });
      
      if (data.encrypted_metadata) {
        this.currentMetadata = this.decrypt(data.encrypted_metadata);
        console.log(`    - Client: Decrypted metadata. Nonce: ${this.currentMetadata.last_used_nullifier_nonce}, Leaf Index: ${this.currentMetadata.commitment_info?.leafIndex ?? 'N/A'}`);
      } else {
        this.currentMetadata = { last_used_nullifier_nonce: 0, commitment_info: null };
        console.log("    - Client: No metadata found. Initialized fresh state.");
      }
    } catch (error: any) {
      if (error.response && error.response.status === 404) {
        this.currentMetadata = { last_used_nullifier_nonce: 0, commitment_info: null };
        console.log("    - Client: No metadata found (404). Initialized fresh state.");
      } else {
        console.error("Failed to fetch metadata:", error.message);
        throw error;
      }
    }
  }

  async postMetadata() {
    console.log(`    - Client: Encrypting and posting metadata update (Nonce: ${this.currentMetadata.last_used_nullifier_nonce})...`);
    const encryptedBlob = this.encrypt(this.currentMetadata);
    const headers = await this.getAuthHeaders("POST /metadata");
    await axios.post(`${INDEXER_API_URL}/metadata`, encryptedBlob, { 
        headers: { ...headers, 'Content-Type': 'text/plain' }
    });
    console.log("    - Client: Metadata posted successfully.");
  }
  
  async getOpenPositions(): Promise<ApiPosition[]> {
    const headers = await this.getAuthHeaders("GET /positions/open");
    const { data } = await axios.get<{ open_positions: ApiPosition[] }>(`${INDEXER_API_URL}/positions/open`, { headers });
    return data.open_positions;
  }
  
  async getHistoricalPositions(): Promise<any[]> {
    const headers = await this.getAuthHeaders("GET /positions/history");
    const { data } = await axios.get(`${INDEXER_API_URL}/positions/history`, { headers });
    return data.items;
  }

  async getUnspentNotes(): Promise<ApiNote[]> {
    const headers = { "X-Receiver-Hash": "0x" + this.receiverHash.toString() };
    const { data } = await axios.get<{ unspent_notes: ApiNote[] }>(`${INDEXER_API_URL}/notes/unspent`, { headers });
    return data.unspent_notes;
  }

  getSecret(): bigint {
    return BigInt(this.secretWallet.privateKey);
  }

  getNextNullifier(): bigint {
    this.currentMetadata.last_used_nullifier_nonce++;
    const secretKey = this.secretWallet.privateKey;
    const nonce = this.currentMetadata.last_used_nullifier_nonce;
    return BigInt(ethers.solidityPackedKeccak256(["bytes32", "uint256"], [secretKey, nonce]));
  }

  // A method to update the user's single private commitment record
  updateCommitment(value: string, leafIndex: number) {
      this.currentMetadata.commitment_info = { value, leafIndex };
  }

  getCommitmentInfo(): { value: string; leafIndex: number; } {
      if (!this.currentMetadata.commitment_info) {
          throw new Error("Client has no active commitment in the dark pool.");
      }
      return this.currentMetadata.commitment_info;
  }
}