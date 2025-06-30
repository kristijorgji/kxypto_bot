import {
    calculateBuyPriceInLamports,
    calculatePumpTokenLamportsValue,
} from '../../../../../../src/blockchains/solana/dex/pumpfun/pump-base';

describe('calculatePumpTokenLamportsValue', () => {
    it('should calculate the lamports amount of X number of raw token amounts correctly', () => {
        expect(calculatePumpTokenLamportsValue(123477, 3.22344e-8)).toBeCloseTo(3.9802070087999994, 8);
    });
});

describe('calculateBuyPriceInLamports', () => {
    it('should calculate the buy price in lamports for a single raw token amount correctly', () => {
        expect(
            calculateBuyPriceInLamports({
                amountRaw: 23523311218007,
                grossTransferredLamports: 1061568978,
            }),
        ).toBeCloseTo(45.12838214661604, 8);
    });
});
