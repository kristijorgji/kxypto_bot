import { LAMPORTS_PER_SOL } from '@solana/web3.js';

import { getRandomDecimal } from '../../utils/data';

export function simulateSolanaNetworkFeeInLamports(): number {
    return getRandomDecimal(0.0009, 0.002, 6) * LAMPORTS_PER_SOL;
}
