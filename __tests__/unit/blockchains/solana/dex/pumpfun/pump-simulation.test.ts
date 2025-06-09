import {
    simulatePumpBuyLatencyMs,
    simulatePumpSellLatencyMs,
} from '@src/blockchains/solana/dex/pumpfun/pump-simulation';

describe(simulatePumpBuyLatencyMs.name, () => {
    it('should use randomised values when varyLatency is set to true', () => {
        const firstValue = simulatePumpBuyLatencyMs(
            0.005,
            {
                jitoEnabled: false,
            },
            true,
        );
        const secondValue = simulatePumpBuyLatencyMs(
            0.005,
            {
                jitoEnabled: false,
            },
            true,
        );

        expect(firstValue).not.toEqual(secondValue);
    });

    it('should use static avg value when varyLatency is set to false', () => {
        for (let i = 0; i < 10; i++) {
            const value = simulatePumpBuyLatencyMs(
                0.005,
                {
                    jitoEnabled: false,
                },
                false,
            );
            expect(value).toEqual(2455.4174165);
        }
    });
});

describe(simulatePumpSellLatencyMs.name, () => {
    it('should use randomised values when varyLatency is set to true', () => {
        const firstValue = simulatePumpSellLatencyMs(
            0.005,
            {
                jitoEnabled: false,
            },
            true,
        );
        const secondValue = simulatePumpSellLatencyMs(
            0.005,
            {
                jitoEnabled: false,
            },
            true,
        );

        expect(firstValue).not.toEqual(secondValue);
    });

    it('should use static avg value when varyLatency is set to false', () => {
        for (let i = 0; i < 10; i++) {
            const value = simulatePumpSellLatencyMs(
                0.005,
                {
                    jitoEnabled: false,
                },
                false,
            );
            expect(value).toEqual(1941.5134375);
        }
    });
});
