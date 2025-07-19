import { ethers, Wallet } from "ethers";
import { apiService } from "@/services/apiService";
import { UserMetadata } from "./types";
import { toast } from "sonner";
import { poseidon2Hash } from "@aztec/foundation/crypto";
import { Fr } from "@aztec/foundation/fields";

export class UserClient {
  public signerAddress: `0x${string}`;
  public secretWallet: Wallet;
  public pubKey: string;
  public receiverSecret: Fr;
  public receiverHash: Fr;
  public currentMetadata: UserMetadata;

  private constructor(
    signerAddress: `0x${string}`,
    privateKeyForSecret: string
  ) {
    this.signerAddress = signerAddress;
    this.secretWallet = new Wallet(privateKeyForSecret);
    this.pubKey = ethers.solidityPackedKeccak256(
      ["address"],
      [this.secretWallet.address]
    );
    this.receiverSecret = new Fr(BigInt(privateKeyForSecret) % Fr.MODULUS);
    this.receiverHash = Fr.ZERO;
    this.currentMetadata = {
      last_used_nullifier_nonce: 0,
      commitment_info: null,
    };
  }

  // Asynchronous factory function for creation
  static async create(
    signerAddress: `0x${string}`,
    signMessage: (args: { message: any }) => Promise<`0x${string}`>
  ): Promise<UserClient> {
    const toastId = toast.loading("Generating secure private key...", {
      description:
        "Please sign the message in your wallet to create your private trading identity. This is a one-time setup.",
      duration: 3000,
    });

    try {
      const signature = await signMessage({
        message: "DarkPerps Login Secret v1.6",
      });
      const privateKey = ethers.keccak256(signature);
      const client = new UserClient(signerAddress, privateKey);
      client.receiverHash = await poseidon2Hash([client.receiverSecret]);

      // After creation, immediately fetch the user's state from the server
      await client.fetchAndSetMetadata();

      toast.success("Private Client Initialized", { id: toastId });
      return client;
    } catch (error: any) {
      toast.error("Private Client Failed", {
        id: toastId,
        description: error.message,
      });
      throw error;
    }
  }

  private encrypt(data: UserMetadata): string {
    const json = JSON.stringify(data);
    return json;
  }

  private decrypt(blob: string): UserMetadata {
    const json = this.hexToString(blob);
    return JSON.parse(json);
  }

  private hexToString(hex: string): string {
    const bytes = new Uint8Array(
      hex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
    );
    return new TextDecoder().decode(bytes);
  }

  private async getAuthHeaders(message: string) {
    const signature = await this.secretWallet.signMessage(message);
    return { "X-Message": message, "X-Signature": signature };
  }

  // --- Public Methods for Interacting with the Backend ---

  async fetchAndSetMetadata(): Promise<void> {
    const { encrypted_metadata } = await apiService.getMetadata(
      await this.getAuthHeaders("GET /private/metadata")
    );
    if (encrypted_metadata) {
      this.currentMetadata = this.decrypt(encrypted_metadata);
    } else {
      this.currentMetadata = {
        last_used_nullifier_nonce: 0,
        commitment_info: null,
      };
    }
  }

  async postMetadata(): Promise<void> {

    const encryptedBlob = this.encrypt(this.currentMetadata);
    await apiService.postMetadata(
      encryptedBlob,
      await this.getAuthHeaders("POST /private/metadata")
    );
    console.log("Metadata posted successfully" + JSON.stringify(this.currentMetadata));
  }

  async getOpenPositions() {
    return apiService.getPrivateOpenPositions(
      await this.getAuthHeaders("GET /private/positions/open")
    );
  }

  async getUnspentNotes() {
    return apiService.getUnspentNotes(this.receiverHash.toString());
  }

  async getHistoricalPositions(cursor?: string) {
    return apiService.getPrivateHistoricalPositions(
      await this.getAuthHeaders("GET /private/positions/history"),
      cursor
    );
  }

  // --- Local State Management ---

  getNextNullifier(): bigint {
    this.currentMetadata.last_used_nullifier_nonce++;
    console.log("New nullifier incremented:", this.currentMetadata.last_used_nullifier_nonce);
    return this.getCurrentNullifier();
  }

  getCurrentNullifier(): bigint {
    const secretKey = this.secretWallet.privateKey;
    const nonce = this.currentMetadata.last_used_nullifier_nonce;
    return (
      BigInt(
        ethers.solidityPackedKeccak256(
          ["bytes32", "uint256"],
          [secretKey, nonce]
        )
      ) % Fr.MODULUS
    );
  }

  getSecret(): bigint {
    return BigInt(this.secretWallet.privateKey) % Fr.MODULUS;
  }

  updateCommitment(value: string, leafIndex: number) {
    this.currentMetadata.commitment_info = { value, leaf_index: leafIndex };
  }

  getCommitmentInfo(): { value: string; leaf_index: number } {
    if (!this.currentMetadata.commitment_info) {
      throw new Error("Client has no active commitment in the dark pool.");
    }
    return this.currentMetadata.commitment_info;
  }

  rollbackNonce(count: number) {
    if (!this.currentMetadata) return;
    this.currentMetadata.last_used_nullifier_nonce -= count;
    console.log("New nullifier decremented:", this.currentMetadata.last_used_nullifier_nonce);
  }
}
