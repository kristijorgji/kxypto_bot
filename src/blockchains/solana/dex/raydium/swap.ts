import { VersionedTransaction } from '@solana/web3.js';

import RaydiumSwap from './RaydiumSwap';
import { logger } from '../../../../logger';

export type SwapConfig = {
    executeSwap: boolean; // Send tx when true, simulate tx when false
    tokenAAmount: number;
    tokenAAddress: string;
    tokenBAddress: string;
    maxLamports: number; // Micro lamports for priority fee
    direction: 'in' | 'out';
    liquidityFile: string;
    maxRetries: 20;
};

/**
 * Performs a token swap on the Raydium protocol.
 * Depending on the configuration, it can execute the swap or simulate it.
 * Based on https://github.com/chainstacklabs/raydium-sdk-swap-example-typescript
 * https://stackoverflow.com/questions/77887585/how-to-swap-solana-tokens-on-raydium-dex
 */
export const swap = async ({
    swapConfig,
    ...args
}: {
    rpcEndpoint: string;
    walletPrivateKey: string;
    swapConfig: SwapConfig;
}) => {
    const raydiumSwap = new RaydiumSwap(args.rpcEndpoint, args.walletPrivateKey);
    logger.info('Raydium swap initialized');
    logger.info(
        `Swapping ${swapConfig.tokenAAmount} of ${swapConfig.tokenAAddress} for ${swapConfig.tokenBAddress}...`,
    );

    /**
     * Load pool keys from the Raydium API to enable finding pool information.
     */
    await raydiumSwap.loadPoolKeys(swapConfig.liquidityFile);
    logger.info('Loaded pool keys');

    /**
     * Find pool information for the given token pair.
     */
    const poolInfo = raydiumSwap.findPoolInfoForTokens(swapConfig.tokenAAddress, swapConfig.tokenBAddress);
    if (!poolInfo) {
        logger.error('Pool info not found');
        return 'Pool info not found';
    } else {
        logger.info('Found pool info');
    }

    /**
     * Prepare the swap transaction with the given parameters.
     */
    const tx = await raydiumSwap.getSwapTransaction(
        swapConfig.tokenBAddress,
        swapConfig.tokenAAmount,
        poolInfo,
        swapConfig.maxLamports,
        swapConfig.direction,
    );

    /**
     * Depending on the configuration, execute or simulate the swap.
     */
    if (swapConfig.executeSwap) {
        /**
         * Send the transaction to the network and log the transaction ID.
         */
        const txid = await raydiumSwap.sendVersionedTransaction(tx as VersionedTransaction, swapConfig.maxRetries);

        logger.info(`https://solscan.io/tx/${txid}`);
    } else {
        /**
         * Simulate the transaction and log the result.
         */
        const simRes = await raydiumSwap.simulateVersionedTransaction(tx as VersionedTransaction);

        logger.info(simRes);
    }
};
