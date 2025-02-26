import { BASE_FEE_LAMPORTS } from '../../../../../src/blockchains/solana/constants/core';
import {
    simulatePriceWithHigherSlippage,
    simulatePriceWithLowerSlippage,
    simulatePriceWithSlippage,
    simulateSolTransactionDetails,
    simulateSolanaFeesInLamports,
} from '../../../../../src/blockchains/solana/utils/simulations';
import { solToLamports } from '../../../../../src/blockchains/utils/amount';

describe(simulateSolanaFeesInLamports, () => {
    it('should return priority fee within the expected range', () => {
        const minExpected = 1_000_000;
        const maxExpected = 5_000_000;

        for (let i = 0; i < 100; i++) {
            const { priorityFeeLamports } = simulateSolanaFeesInLamports();

            expect(priorityFeeLamports).toBeGreaterThanOrEqual(minExpected);
            expect(priorityFeeLamports).toBeLessThanOrEqual(maxExpected);
        }
    });

    it('should correctly compute total fee', () => {
        for (let i = 0; i < 100; i++) {
            const { priorityFeeLamports, totalFeeLamports } = simulateSolanaFeesInLamports();

            expect(totalFeeLamports).toBe(BASE_FEE_LAMPORTS + priorityFeeLamports);
        }
    });

    it('should return different priority fees across multiple calls', () => {
        const feesSet = new Set<number>();

        for (let i = 0; i < 10; i++) {
            const { priorityFeeLamports } = simulateSolanaFeesInLamports();
            feesSet.add(priorityFeeLamports);
        }

        expect(feesSet.size).toBeGreaterThan(1); // Ensures randomness
    });
});

describe(simulateSolTransactionDetails.name, () => {
    it('should calculate correct netTransferredLamports', () => {
        const actual = simulateSolTransactionDetails(1_000_000);

        expect(actual).toEqual({
            grossTransferredLamports: 1_000_000,
            netTransferredLamports: 1_000_000 - actual.totalFeeLamports,
            baseFeeLamports: BASE_FEE_LAMPORTS,
            priorityFeeLamports: actual.priorityFeeLamports,
            totalFeeLamports: actual.totalFeeLamports,
        });
    });

    it('should calculate correct netTransferredLamports when we pass priority fees', () => {
        const actual = simulateSolTransactionDetails(1_000_000, solToLamports(0.035));

        expect(actual).toEqual({
            grossTransferredLamports: 1_000_000,
            netTransferredLamports: 1_000_000 - 35_000_000 - BASE_FEE_LAMPORTS,
            baseFeeLamports: BASE_FEE_LAMPORTS,
            priorityFeeLamports: 35_000_000,
            totalFeeLamports: 35_005_000,
        });
    });
});

const simulatePriceWithSlippageCases: [
    name: string,
    data: {
        lamportsPrice: number;
        slippageDecimal: number;
    },
][] = [
    [
        'should return a price within the correct slippage range (positive and negative)',
        {
            lamportsPrice: 1_000_000_000,
            slippageDecimal: 0.05,
        },
    ],
    [
        'should correctly handle very small slippage values',
        {
            lamportsPrice: 1_000_000_000,
            slippageDecimal: 0.0001,
        },
    ],
    [
        'should correctly handle large slippage values',
        {
            lamportsPrice: 1_000_000_000,
            slippageDecimal: 0.5,
        },
    ],
];

describe(simulatePriceWithSlippage.name, () => {
    test.each(simulatePriceWithSlippageCases)('%s', (_, { lamportsPrice, slippageDecimal }) => {
        const minExpected = lamportsPrice * (1 - slippageDecimal);
        const maxExpected = lamportsPrice * (1 + slippageDecimal);

        for (let i = 0; i < 100; i++) {
            const result = simulatePriceWithSlippage(lamportsPrice, slippageDecimal);

            expect(result).toBeGreaterThanOrEqual(minExpected);
            expect(result).toBeLessThanOrEqual(maxExpected);
        }
    });

    it('should return the same price when slippage is 0', () => {
        const lamportsPrice = 1_000_000_000; // 1 SOL
        const result = simulatePriceWithSlippage(lamportsPrice, 0);

        expect(result).toBe(lamportsPrice);
    });
});

describe(simulatePriceWithLowerSlippage.name, () => {
    test.each(simulatePriceWithSlippageCases)('%s', (_, { lamportsPrice, slippageDecimal }) => {
        const minExpected = lamportsPrice * (1 - slippageDecimal);

        for (let i = 0; i < 100; i++) {
            const result = simulatePriceWithLowerSlippage(lamportsPrice, slippageDecimal);

            expect(result).toBeGreaterThanOrEqual(minExpected);
            expect(result).toBeLessThanOrEqual(lamportsPrice);
        }
    });

    it('should return the same price when slippage is 0', () => {
        const lamportsPrice = 1_000_000_000; // 1 SOL
        const result = simulatePriceWithLowerSlippage(lamportsPrice, 0);

        expect(result).toBe(lamportsPrice);
    });
});

describe(simulatePriceWithHigherSlippage.name, () => {
    test.each(simulatePriceWithSlippageCases)('%s', (_, { lamportsPrice, slippageDecimal }) => {
        const maxExpected = lamportsPrice * (1 + slippageDecimal);

        for (let i = 0; i < 100; i++) {
            const result = simulatePriceWithHigherSlippage(lamportsPrice, slippageDecimal);

            expect(result).toBeGreaterThanOrEqual(lamportsPrice);
            expect(result).toBeLessThanOrEqual(maxExpected);
        }
    });

    it('should return the same price when slippage is 0', () => {
        const lamportsPrice = 1_000_000_000; // 1 SOL
        const result = simulatePriceWithHigherSlippage(lamportsPrice, 0);

        expect(result).toBe(lamportsPrice);
    });
});
