// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IDefiAdaptor} from "./IDefiAdaptor.sol";
import {IEntryPoint} from "../interfaces/IEntryPoint.sol";
import {IERC20Minimal} from "../interfaces/IERC20Minimal.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
// import {IPedersenHasher} from "../interfaces/IPedersenHasher.sol"; // If you had an on-chain one
// For Uniswap interaction (example using V2 Router interface)
interface IUniswapV2Router02 {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);

    function swapExactETHForTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable returns (uint[] memory amounts);

    function swapExactTokensForETH(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);

    function WETH() external pure returns (address);
}

// Placeholder for the commitment generation logic.
// In a real scenario, this must match the Noir circuit's commitment_hasher.
// commitment = H_pedersen(value, asset_label, H_pedersen(nullifier, secret))
// For a *new* output note, the 'nullifier' and 'secret' are fresh values chosen by the user
// and represented by receiverOutputSecretHash = H_pedersen(new_output_nullifier, new_output_secret)
// The `asset_label` is derived from the outputAsset address.
library OutputCommitmentLib {
    // This is highly simplified. Real Pedersen hashing is complex.
    // Assume `receiverOutputSecretHash` IS the precommitment part for the new output note.
    // precommitment = pedersen_hash([new_output_nullifier, new_output_secret])
    // The user would have generated this `receiverOutputSecretHash` using their intended new nullifier and secret.
    function computeOutputCommitment(
        uint256 value,
        address assetAddress,
        bytes32 receiverPrecommitment // This is the receiverOutputSecretHash
        // IPedersenHasher pedersen // If using an on-chain hasher
    ) internal pure returns (bytes32) {
        // label = uint256(uint160(assetAddress)) % SNARK_SCALAR_FIELD; (from your Noir notes)
        // This modulo is important for Pedersen. For simplicity, we just use assetAddress.
        bytes32 assetLabel = bytes32(uint256(uint160(assetAddress))); // Simplified label
        return keccak256(abi.encodePacked("PEDERSEN_PLACEHOLDER", value, assetLabel, receiverPrecommitment));
        // Replace with actual Pedersen: pedersen_hash([valueFr, labelFr, receiverPrecommitmentFr]);
    }
}


contract UniswapAdaptor is IDefiAdaptor {
    using SafeERC20 for IERC20Minimal;

    address public immutable override entryPoint;
    IUniswapV2Router02 public immutable uniswapRouter;
    // IPedersenHasher public immutable pedersenHasher; // If using on-chain Pedersen

    // Example: Store WETH address if commonly used
    address public immutable WETH;

    // Modifiers
    modifier onlyEntryPoint() {
        require(msg.sender == entryPoint, "UniswapAdaptor: Caller is not the EntryPoint");
        _;
    }

    constructor(address _entryPoint, address _uniswapRouterAddress/*, address _pedersenHasherAddress*/) {
        require(_entryPoint != address(0), "UniswapAdaptor: Invalid EntryPoint");
        require(_uniswapRouterAddress != address(0), "UniswapAdaptor: Invalid Router");
        // require(_pedersenHasherAddress != address(0), "UniswapAdaptor: Invalid Pedersen Hasher");

        entryPoint = _entryPoint;
        uniswapRouter = IUniswapV2Router02(_uniswapRouterAddress);
        WETH = uniswapRouter.WETH();
        // pedersenHasher = IPedersenHasher(_pedersenHasherAddress);
    }

    /**
     * @inheritdoc IDefiAdaptor
     * @dev For defiCalldata, a simple example: abi.encode(address[] path, uint256 deadline)
     *      path: The token swap path (e.g., [tokenIn, WETH, tokenOut])
     *      deadline: Standard Uniswap deadline
     */
    function execute(
        address user, // Original user from EntryPoint
        address sourceToken, // Token received from EntryPoint (could be address(0) for ETH if adaptor handles it)
        uint256 sourceAmount,
        address outputAssetIntended, // Expected output token
        uint256 minOutputAmount, // Slippage protection
        bytes32 receiverOutputSecretHash, // User's H(new_nullifier, new_secret) for the output
        bytes calldata defiCalldata
    ) external override onlyEntryPoint returns (
        address outputAsset,
        uint256 outputAmount,
        bytes32 outputCommitment
    ) {
        // Decode defiCalldata
        (address[] memory path, uint deadline) = abi.decode(defiCalldata, (address[], uint));
        require(path.length >= 2, "UniswapAdaptor: Invalid path");
        require(path[0] == sourceToken || (sourceToken == address(0) && path[0] == WETH), "UniswapAdaptor: Path input token mismatch");
        require(path[path.length - 1] == outputAssetIntended, "UniswapAdaptor: Path output token mismatch");

        // Perform the swap
        // The EntryPoint has already sent `sourceAmount` of `sourceToken` to this contract.
        // We need to approve the Uniswap router to spend it.
        uint256[] memory amounts;

        if (sourceToken == address(0)) { // ETH in (EntryPoint should have sent ETH via msg.value)
            // This adaptor needs to be payable if it handles ETH directly from EntryPoint.
            // However, EntryPoint already transferred funds to this adaptor.
            // If EntryPoint sent ETH to this contract, this contract now holds that ETH.
            // It needs to wrap ETH to WETH if path[0] is WETH.
            // For simplicity, let's assume if sourceToken is address(0), EntryPoint means ETH,
            // and the path should start with WETH. The EntryPoint would handle wrapping ETH to WETH
            // before transferring to the adaptor, or this adaptor handles it.
            // Current EntryPoint logic sends sourceAsset to adaptor. If ETH, it's raw ETH.
            // So, this adaptor receives raw ETH.
            require(path[0] == WETH, "UniswapAdaptor: ETH input requires WETH path start");
            // Wrap ETH to WETH - this is complex as adaptor needs to manage WETH balance
            // A simpler model: EntryPoint *always* deals in ERC20s for adaptors, wraps ETH if needed.
            // Let's assume EntryPoint provides WETH if source was ETH. So sourceToken is WETH here.
            // If sourceToken *can* be address(0) and means ETH, then EntryPoint must send ETH with the call.
            // Let's modify: if sourceToken comes as address(0), this adaptor handles it as ETH.
             revert("UniswapAdaptor: Direct ETH input not supported in this simplified version. Use WETH.");

        } else { // ERC20 in
            IERC20Minimal(sourceToken).safeApprove(address(uniswapRouter), sourceAmount);
            if (outputAssetIntended == address(0)) { // Swapping Tokens for ETH
                 amounts = uniswapRouter.swapExactTokensForETH(
                    sourceAmount,
                    minOutputAmount,
                    path,
                    address(this), // Output ETH comes to this adaptor
                    deadline
                );
                outputAsset = address(0); // Representing ETH
                outputAmount = address(this).balance; // Check balance *after* to see ETH received
                                                    // This is tricky, need to manage pre-existing ETH balance.
                                                    // Better to swap to WETH then unwrap.
                revert("UniswapAdaptor: Direct ETH output not fully supported. Swap to WETH then manage unwrap.");

            } else { // Swapping Tokens for Tokens
                amounts = uniswapRouter.swapExactTokensForTokens(
                    sourceAmount,
                    minOutputAmount,
                    path,
                    address(this), // Output tokens come to this adaptor
                    deadline
                );
                outputAsset = path[path.length - 1];
                outputAmount = amounts[amounts.length - 1];
            }
        }

        require(outputAmount >= minOutputAmount, "UniswapAdaptor: Slippage too high");
        require(outputAsset == outputAssetIntended, "UniswapAdaptor: Unexpected output asset");

        // Compute the Pedersen commitment for the output
        // The user (via EntryPoint) provided `receiverOutputSecretHash`.
        // This hash is effectively the precommitment for their new output note.
        // precommitment_output = H_pedersen(new_output_nullifier, new_output_secret)
        outputCommitment = OutputCommitmentLib.computeOutputCommitment(
            outputAmount,
            outputAsset, // If ETH output, use WETH address for commitment consistency or a convention
            receiverOutputSecretHash
            // , pedersenHasher
        );

        emit InteractionExecuted(
            sourceToken, // This was the input to the adaptor
            sourceAmount,
            address(uniswapRouter),
            outputAsset,
            outputAmount,
            outputCommitment,
            receiverOutputSecretHash
        );

        // The outputAsset (amount: outputAmount) is now held by this adaptor.
        // The EntryPoint will NOT automatically pull it. The user will `claim` this `outputCommitment`.
        // When they claim, the corresponding AssetPool for `outputAsset` will need these funds.
        // This implies a secondary step:
        // 1. User `claim`s `outputCommitment` via EntryPoint.
        // 2. The `AssetPool` for `outputAsset` requests/pulls `outputAmount` from this `UniswapAdaptor`.
        // This is complex.
        //
        // Simpler: Adaptor transfers output tokens directly to the relevant AssetPool or EntryPoint.
        // Or, EntryPoint, after this `execute` call, pulls the `outputAmount` from the adaptor.
        //
        // Let's assume the adaptor should transfer the output back to the EntryPoint,
        // so EntryPoint can manage it for the user's eventual claim into an AssetPool.
        if (outputAsset == address(0)) { // ETH output
            // payable(entryPoint).transfer(outputAmount); // This requires EntryPoint to be payable
            // This is complex if output is ETH. Let's assume output is always ERC20 (WETH for ETH).
            revert("UniswapAdaptor: Direct ETH output to EntryPoint not implemented, use WETH.");
        } else { // ERC20 output
            IERC20Minimal(outputAsset).safeTransfer(entryPoint, outputAmount);
        }

        return (outputAsset, outputAmount, outputCommitment);
    }
}