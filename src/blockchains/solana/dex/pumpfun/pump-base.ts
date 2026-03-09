import { PUMPFUN_TOKEN_DECIMALS } from '@src/blockchains/solana/dex/pumpfun/constants';
import { solToLamports } from '@src/blockchains/utils/amount';

export function calculatePumpTokenLamportsValue(amountRaw: number, priceInSol: number): number {
    return solToLamports(priceInSol * (amountRaw / 10 ** PUMPFUN_TOKEN_DECIMALS));
}

export function calculatePriceInLamports({ amountRaw, lamports }: { amountRaw: number; lamports: number }): number {
    return (Math.abs(lamports) / amountRaw) * 10 ** PUMPFUN_TOKEN_DECIMALS;
}
