import { BASE_FEE_LAMPORTS } from '../../../../../src/blockchains/solana/constants/core';
import { ExecutionLatencyData } from '../../../../../src/blockchains/solana/types';
import {
    getLatencyMetrics,
    simulatePriceWithHigherSlippage,
    simulatePriceWithLowerSlippage,
    simulatePriceWithSlippage,
    simulateSolTransactionDetails,
    simulateSolanaFeesInLamports,
} from '../../../../../src/blockchains/solana/utils/simulations';
import { solToLamports } from '../../../../../src/blockchains/utils/amount';
import { LatencyMetrics } from '../../../../../src/utils/simulations';

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

describe(getLatencyMetrics.name, () => {
    const mockLatency: LatencyMetrics = { minTimeNs: 100, maxTimeNs: 200, avgTimeNs: 150, medianTimeNs: 175 };

    const mockData: ExecutionLatencyData = {
        rpc: {
            priorityFee: {
                0.1: { minTimeNs: 110, maxTimeNs: 210, avgTimeNs: 160, medianTimeNs: 180 },
                0.2: { minTimeNs: 120, maxTimeNs: 220, avgTimeNs: 170, medianTimeNs: 190 },
                0.5: { minTimeNs: 150, maxTimeNs: 250, avgTimeNs: 200, medianTimeNs: 220 },
            },
            default: mockLatency,
        },
        jito: {
            tip: {
                1000: { minTimeNs: 130, maxTimeNs: 230, avgTimeNs: 180, medianTimeNs: 200 },
                5000: { minTimeNs: 140, maxTimeNs: 240, avgTimeNs: 190, medianTimeNs: 210 },
            },
            default: mockLatency,
        },
    };

    test('returns exact match for priority fee', () => {
        const result = getLatencyMetrics(mockData, 0.2, { jitoEnabled: false, tipLamports: undefined });
        expect(result).toEqual(mockData.rpc.priorityFee[0.2]);
    });

    test('returns nearest priority fee when exact match is missing', () => {
        const result = getLatencyMetrics(mockData, 0.3, { jitoEnabled: false, tipLamports: undefined });
        expect(result).toEqual(mockData.rpc.priorityFee[0.2]); // Closest to 0.3
    });

    test('returns default RPC latency when no priority fee exists', () => {
        const result = getLatencyMetrics(
            {
                rpc: {
                    default: mockLatency,
                    priorityFee: {},
                },
                jito: {
                    default: mockLatency,
                    tip: {},
                },
            },
            1.0,
            { jitoEnabled: false, tipLamports: undefined },
        );
        expect(result).toEqual(mockLatency);
    });

    test('returns exact match for Jito tip', () => {
        const result = getLatencyMetrics(mockData, 0.1, { jitoEnabled: true, tipLamports: 1000 });
        expect(result).toEqual(mockData.jito.tip[1000]);
    });

    test('returns nearest Jito tip when exact match is missing', () => {
        const result = getLatencyMetrics(mockData, 0.1, { jitoEnabled: true, tipLamports: 3000 });
        expect(result).toEqual(mockData.jito.tip[1000]); // Closest to 3000
    });

    test('returns default Jito latency when no Jito tip exists', () => {
        const result = getLatencyMetrics(
            {
                rpc: {
                    default: mockLatency,
                    priorityFee: {},
                },
                jito: {
                    default: mockLatency,
                    tip: {},
                },
            },
            0.1,
            { jitoEnabled: true, tipLamports: 8000 },
        );
        expect(result).toEqual(mockLatency); // Closest to 8000
    });

    test('returns default RPC latency when priorityFeeInSol and Jito are both unavailable', () => {
        const emptyData: ExecutionLatencyData = {
            rpc: { priorityFee: {}, default: mockLatency },
            jito: { tip: {}, default: mockLatency },
        };
        const result = getLatencyMetrics(emptyData, 0.1, { jitoEnabled: false, tipLamports: undefined });
        expect(result).toEqual(mockLatency);
    });

    test('returns default Jito latency when Jito is enabled but no tips are found', () => {
        const emptyData: ExecutionLatencyData = {
            rpc: { priorityFee: {}, default: mockLatency },
            jito: { tip: {}, default: mockLatency },
        };
        const result = getLatencyMetrics(emptyData, 0.1, { jitoEnabled: true, tipLamports: 1000 });
        expect(result).toEqual(mockLatency);
    });
});
