import { VersionedTransaction } from '@solana/web3.js';

import RaydiumDex, { RaydiumDexConfig } from './RaydiumDex';
import { logger } from '../../../../logger';

export enum SwapDirection {
    IN = 'in',
    OUT = 'out',
}

const DEFAULT_MAX_RETRIES = 20;

export type SwapConfig = RaydiumDexConfig & {
    executeSwap: boolean;
    tokenAAmount: number;
    tokenAAddress: string;
    tokenBAddress: string;
    maxLamports: number;
    direction: SwapDirection;
    liquidityFile: string;
    maxRetries?: number;
};

export type SwapResult = {
    status: 'success' | 'error';
    data: string | unknown;
};

/**
 * Performs a token swap on the Raydium protocol.
 * Depending on the configuration, it can execute the swap or simulate it.
 */
export const executeRaydiumSwap = async (swapConfig: SwapConfig): Promise<SwapResult> => {
    const {
        tokenAAmount,
        tokenAAddress,
        tokenBAddress,
        maxLamports,
        direction,
        rpcUrl,
        walletPrivateKey,
        liquidityFile,
    } = swapConfig;

    const maxRetries = swapConfig.maxRetries ?? DEFAULT_MAX_RETRIES;

    logger.info(`Raydium swap initialized at ${swapConfig.rpcUrl}`);
    logger.info(`Swapping ${tokenAAmount} of ${tokenAAddress} for ${tokenBAddress}...`);

    try {
        const raydiumSwap = new RaydiumDex({ rpcUrl, walletPrivateKey, liquidityFile });
        await raydiumSwap.loadPoolKeys(liquidityFile);
        logger.info('Loaded pool keys');

        const poolInfo = raydiumSwap.findPoolInfoForTokens(tokenAAddress, tokenBAddress);
        if (!poolInfo) {
            return {
                status: 'error',
                data: 'Pool info not found',
            };
        }
        logger.info('Found pool info');

        const swapTransaction = await raydiumSwap.getSwapTransaction(
            tokenBAddress,
            tokenAAmount,
            poolInfo,
            maxLamports,
            direction,
        );

        const transaction = swapTransaction as VersionedTransaction;

        if (swapConfig.executeSwap) {
            const transactionId = await raydiumSwap.sendVersionedTransaction(transaction, maxRetries);
            return {
                status: 'success',
                data: `https://solscan.io/tx/${transactionId}`,
            };
        } else {
            const simulationResult = await raydiumSwap.simulateVersionedTransaction(transaction);
            return {
                status: 'success',
                data: simulationResult,
            };
        }
    } catch (error) {
        logger.error('Swap execution failed:', error);
        return {
            status: 'error',
            data: error instanceof Error ? error.message : 'Unknown error occurred',
        };
    }
};
