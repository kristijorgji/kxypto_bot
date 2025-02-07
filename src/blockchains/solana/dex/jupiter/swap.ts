import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import axios from 'axios';

import { logger } from '../../../../logger';
import { percentageToBps } from '../../../utils/amount';

/**
 * https://station.jup.ag/docs/apis/swap-api
 * https://solana.stackexchange.com/a/14219/34703
 * https://gist.github.com/NotoriousPyro/e7ecd13fdc1f068cd2f85dcc7f0948d5
 */
export default async function swap(
    connection: Connection,
    keypair: Keypair,
    config: {
        inputMint: string;
        outputMint: string;
        amount: number; // amount * 10 * decimals for a given mint
        slippagePercentage: number;
        verbose?: boolean;
    },
) {
    const verbose = config.verbose ?? true;

    const quoteResponse = await axios.get('https://quote-api.jup.ag/v6/quote', {
        params: {
            inputMint: config.inputMint,
            outputMint: config.outputMint,
            amount: config.amount,
            slippageBps: percentageToBps(config.slippagePercentage),
        },
    });
    if (verbose) {
        logger.verbose('quoteResponse: %o', quoteResponse.data);
    }

    // Get serialized transactions for the swap
    const swapResponse = await axios.post(
        'https://quote-api.jup.ag/v6/swap',
        {
            quoteResponse: quoteResponse.data,
            userPublicKey: keypair.publicKey.toString(),
            wrapAndUnwrapSol: true,
            // prioritizationFeeLamports: 50000, // if this is too low the transaction might expire as the validator nodes will not pick it up
        },
        {
            headers: {
                'Content-Type': 'application/json',
            },
        },
    );

    const { swapTransaction } = swapResponse.data;

    // Deserialize the transaction
    const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    // Replace the blockhash
    const latestBlockHash = await connection.getLatestBlockhashAndContext();
    transaction.message.recentBlockhash = latestBlockHash.value.blockhash;

    // Sign the transaction
    transaction.sign([keypair]);

    // Simulate
    const simulation = await connection.simulateTransaction(transaction, { commitment: 'processed' });
    if (simulation.value.err) {
        throw new Error('Simulate failed: ' + simulation.value.err);
    }

    const signature = await connection.sendTransaction(transaction, {
        skipPreflight: true,
        preflightCommitment: 'processed',
    });
    const confirmation = await connection.confirmTransaction({
        signature: signature,
        lastValidBlockHeight: latestBlockHash.value.lastValidBlockHeight,
        blockhash: latestBlockHash.value.blockhash,
    });
    if (confirmation.value.err) {
        throw new Error('Transaction failed: ' + confirmation.value.err);
    }

    return {
        signature: signature,
        solscanUrl: `https://solscan.io/tx/${signature}`,
    };
}
