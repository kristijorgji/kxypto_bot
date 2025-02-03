import {
    ComputeBudgetProgram,
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    Transaction,
    TransactionInstruction,
} from '@solana/web3.js';
import bs58 from 'bs58';

export async function getKeyPairFromPrivateKey(key: string) {
    return Keypair.fromSecretKey(new Uint8Array(bs58.decode(key)));
}

export async function createTransaction(
    connection: Connection,
    instructions: TransactionInstruction[],
    payer: PublicKey,
    priorityFeeInSol: number = 0,
): Promise<Transaction> {
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
        units: 1000000,
    });

    const transaction = new Transaction().add(modifyComputeUnits);

    if (priorityFeeInSol > 0) {
        const microLamports = priorityFeeInSol * LAMPORTS_PER_SOL;
        const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
            microLamports,
        });
        transaction.add(addPriorityFee);
    }

    transaction.add(...instructions);

    transaction.feePayer = payer;
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    return transaction;
}
