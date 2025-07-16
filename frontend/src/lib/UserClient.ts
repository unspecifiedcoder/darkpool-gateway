import { useSignMessage } from 'wagmi';

export class UserClient {
  static async create(
    signerAddress: `0x${string}`,
    signMessageAsync: ReturnType<typeof useSignMessage>['signMessageAsync']
  ): Promise<UserClient> {
    
    console.log(`Simulating signature for ${signerAddress} to generate secret...`);
    await signMessageAsync({ message: "DarkPerps Login Secret v1", account: signerAddress });
    
    return new UserClient();
  }
}