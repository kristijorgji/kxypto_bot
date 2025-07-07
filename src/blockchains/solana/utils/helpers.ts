import { AnchorError, ProgramError } from '@coral-xyz/anchor';
import {
    Commitment,
    ComputeBudgetProgram,
    Connection,
    Finality,
    Keypair,
    PublicKey,
    SendTransactionError,
    SystemProgram,
    Transaction,
    TransactionMessage,
    VersionedTransaction,
    VersionedTransactionResponse,
} from '@solana/web3.js';
import bs58 from 'bs58';

import { PriorityFee, TransactionResult } from '../types';
import TransactionError from './TransactionError';
import { JitoEndpoint, TIP_LAMPORTS, jitoClient } from '../Jito';

export const DEFAULT_COMMITMENT: Commitment = 'finalized';
export const DEFAULT_FINALITY: Finality = 'finalized';

export function getKeyPairFromPrivateKey(key: string): Keypair {
    return Keypair.fromSecretKey(new Uint8Array(bs58.decode(key)));
}

export async function sendTx(
    connection: Connection,
    tx: Transaction,
    payer: PublicKey,
    signers: Keypair[],
    priorityFees?: PriorityFee,
    commitment: Commitment = DEFAULT_COMMITMENT,
    finality: Finality = DEFAULT_FINALITY,
    jito: boolean = false,
    tipLamports: number = TIP_LAMPORTS,
    jitoEndpoint?: JitoEndpoint,
): Promise<TransactionResult> {
    const newTx = new Transaction();

    if (priorityFees) {
        const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
            units: priorityFees.unitLimit,
        });

        const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: priorityFees.unitPrice,
        });
        newTx.add(modifyComputeUnits);
        newTx.add(addPriorityFee);
    }

    if (jito) {
        const tipInstruction = SystemProgram.transfer({
            fromPubkey: payer,
            toPubkey: new PublicKey(jitoClient.getRandomTipAccount()),
            lamports: tipLamports,
        });
        newTx.add(tipInstruction);
    }

    newTx.add(tx);

    const versionedTx = await buildVersionedTx(connection, payer, newTx, commitment);
    versionedTx.sign(signers);

    try {
        if (jito) {
            // @ts-ignore
            const serializedTx = Buffer.from(versionedTx.serialize()).toString('base64');

            return {
                success: true,
                signature: await jitoClient.sendTransaction(serializedTx, jitoEndpoint),
                results: undefined,
            };
        } else {
            const signature = await connection.sendTransaction(versionedTx, {
                skipPreflight: false,
                preflightCommitment: commitment,
            });

            const txResult = await getTxDetails(connection, signature, commitment, finality);
            if (!txResult) {
                return {
                    success: false,
                    error: 'Transaction failed',
                };
            }
            return {
                success: true,
                signature: signature,
                results: txResult,
            };
        }
    } catch (e) {
        let errorMessage: string;
        let logs: string[] | undefined;

        if (e instanceof SendTransactionError) {
            logs = await e.getLogs(connection);

            if (logs?.some(log => log.includes('exceeded CUs meter'))) {
                errorMessage = 'Transaction failed: Compute budget exceeded. Try increasing compute unit limit.';
            } else if (e.message.includes('custom program error:')) {
                try {
                    const anchorError = AnchorError.parse(logs || [e.message]);
                    errorMessage = `Anchor Error: ${anchorError?.error?.errorMessage || 'Unknown anchor error'}`;
                } catch {
                    errorMessage = 'Program Error: ' + e.message;
                }
            } else {
                errorMessage = 'Transaction Error: ' + e.message;
            }
        } else if (e instanceof ProgramError) {
            errorMessage = `Program Error: ${e.msg || e.message}`;
            logs = e.logs;
        } else {
            errorMessage = `Unknown Error: ${
                e instanceof Error ? e.message : typeof e === 'object' && e !== null ? JSON.stringify(e) : String(e)
            }`;
        }

        const txError = new TransactionError(errorMessage, logs);

        return {
            error: txError,
            success: false,
        };
    }
}

export const buildVersionedTx = async (
    connection: Connection,
    payer: PublicKey,
    tx: Transaction,
    commitment: Commitment = DEFAULT_COMMITMENT,
): Promise<VersionedTransaction> => {
    const blockHash = (await connection.getLatestBlockhash(commitment)).blockhash;

    const messageV0 = new TransactionMessage({
        payerKey: payer,
        recentBlockhash: blockHash,
        instructions: tx.instructions,
    }).compileToV0Message();

    return new VersionedTransaction(messageV0);
};

export const getTxDetails = async (
    connection: Connection,
    sig: string,
    commitment: Commitment = DEFAULT_COMMITMENT,
    finality: Finality = DEFAULT_FINALITY,
): Promise<VersionedTransactionResponse | null> => {
    try {
        bs58.decode(sig);
    } catch (_) {
        return null;
    }

    const latestBlockHash = await connection.getLatestBlockhash();
    await connection.confirmTransaction(
        {
            blockhash: latestBlockHash.blockhash,
            lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
            signature: sig,
        },
        commitment,
    );

    return connection.getTransaction(sig, {
        maxSupportedTransactionVersion: 0,
        commitment: finality,
    });
};
