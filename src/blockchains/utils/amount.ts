import { LAMPORTS_PER_SOL } from '@solana/web3.js';

export function solToLamports(solAmount: number): number {
    return solAmount * LAMPORTS_PER_SOL;
}

export function lamportsToSol(lamports: number): number {
    return lamports / LAMPORTS_PER_SOL;
}
