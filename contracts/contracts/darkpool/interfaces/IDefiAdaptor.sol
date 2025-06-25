// contracts/adaptors/IDefiAdaptor.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IDefiAdaptor {
    event InteractionExecuted(
        address indexed sourceAsset,      // From Xythum pool
        uint256 sourceAmountUsed,
        address indexed targetProtocol,   // e.g., Uniswap Router
        address outputAsset,              // Asset received from DeFi action
        uint256 outputAmount,
        bytes32 indexed outputCommitment, // Pedersen commitment for the output asset, for the user to claim
        bytes32 outputReceiverSecretHash  // User's secret hash for the outputCommitment
    );

    function entryPoint() external view returns (address);
    // Verifier is usually managed by EntryPoint for the adaptor
    // function verifier() external view returns (address);

    /**
     * @notice Executes a DeFi action.
     * @dev Called by the Xythum EntryPoint contract.
     * The EntryPoint will have already transferred `sourceAmount` of `sourceToken` to this adaptor.
     * This function performs the DeFi interaction and prepares data for the user to claim the output.
     *
     * @param user The original user initiating the DeFi action.
     * @param sourceToken The token address provided by the user from their Xythum pool.
     * @param sourceAmount The amount of sourceToken transferred to this adaptor for the DeFi action.
     * @param outputAssetIntended The asset the user expects to receive back (for validation or path selection).
     * @param minOutputAmount The minimum amount of outputAsset the user is willing to accept (slippage protection).
     * @param receiverOutputSecretHash Hash of the user's secret for the new output commitment. This hash
     *                                 will be part of the output commitment.
     * @param defiCalldata Adaptor-specific calldata to perform the DeFi interaction (e.g., Uniswap path, deadline).
     * @return outputAsset Address of the asset actually received from the DeFi interaction.
     * @return outputAmount Amount of the outputAsset actually received.
     * @return outputCommitment The Pedersen commitment leaf for the `outputAsset` and `outputAmount`,
     *                          incorporating `receiverOutputSecretHash`. This is what the user will claim.
     */
    function execute(
        address user,
        address sourceToken,
        uint256 sourceAmount,
        address outputAssetIntended,
        uint256 minOutputAmount,
        bytes32 receiverOutputSecretHash, // User's secret hash for the *output* commitment
        bytes calldata defiCalldata
    ) external returns (
        address outputAsset,
        uint256 outputAmount,
        bytes32 outputCommitment
    );
}