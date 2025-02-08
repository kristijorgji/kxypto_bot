import { API_URLS, TxVersion } from '@raydium-io/raydium-sdk-v2';
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import axios from 'axios';

import { ComputeSwapResponse } from './computeSwap';
import { GetOrCreateTokenAccountsResponse } from './getOrCreateWalletTokenAccounts';
import { logger } from '../../../../logger';

type SwapTransaction = {
    id: string;
    version: string;
    success: boolean;
    data: { transaction: string }[];
};

export type SwapTransactionConfig = {
    priorityFee: number;
    swapResponse: ComputeSwapResponse;
    wallet: Keypair;
    isInputSol: boolean;
    isOutputSol: boolean;
    tokenAccounts: GetOrCreateTokenAccountsResponse;
};

export async function getSwapTransactions({
    priorityFee,
    swapResponse,
    wallet,
    isInputSol,
    isOutputSol,
    tokenAccounts,
}: SwapTransactionConfig): Promise<VersionedTransaction[]> {
    logger.info('Getting swap transactions');
    const swapTransactions = await axios.post<SwapTransaction>(`${API_URLS.SWAP_HOST}/transaction/swap-base-in`, {
        computeUnitPriceMicroLamports: String(priorityFee),
        swapResponse,
        txVersion: TxVersion[TxVersion.V0],
        wallet: wallet.publicKey.toBase58(),
        wrapSol: isInputSol,
        unwrapSol: isOutputSol,
        inputAccount: tokenAccounts.inputTokenAccount,
        outputAccount: tokenAccounts.outputTokenAccount,
    });

    return swapTransactions.data.data
        .map(tx => Buffer.from(tx.transaction, 'base64'))
        .map(txBuf => VersionedTransaction.deserialize(txBuf));
}
