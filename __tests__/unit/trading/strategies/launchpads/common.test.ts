import { TradeTransactionFactory } from '../../../../../src/testdata/factories/bot';
import { HandlePumpTokenBotReport } from '../../../../../src/trading/bots/blockchains/solana/types';
import { HistoryEntry, MarketContext } from '../../../../../src/trading/bots/launchpads/types';
import { ShouldExitMonitoringResponse } from '../../../../../src/trading/bots/types';
import {
    checkInterval,
    shouldBuyStateless,
    shouldExitLaunchpadToken,
} from '../../../../../src/trading/strategies/launchpads/common';
import {
    IntervalConfig,
    LaunchpadBuyPosition,
    LaunchpadStrategyBuyConfig,
} from '../../../../../src/trading/strategies/types';
import { walkDirFilesSyncRecursive } from '../../../../../src/utils/files';
import { formHistoryEntry, formMarketContext } from '../../../../__utils/blockchains/solana';
import { localFixturesPath, readLocalFixture } from '../../../../__utils/data';

describe(shouldBuyStateless.name, () => {
    test('should return true when all values are within range', () => {
        const buyConfig: LaunchpadStrategyBuyConfig = {
            price: {
                min: 100,
                max: 101,
            },
            marketCap: {
                min: 100,
                max: 101,
            },
            holdersCount: { min: 100, max: 500 },
            bondingCurveProgress: { min: 10, max: 90 },
            devHoldingPercentage: { min: 2, max: 10 },
            topTenHoldingPercentage: { min: 5, max: 50 },
            devHoldingPercentageCirculating: { min: 5, max: 20 },
            topTenHoldingPercentageCirculating: { min: 5, max: 70 },
            topHolderCirculatingPercentage: { min: 10, max: 12 },
        };

        const marketContext: MarketContext = {
            price: 100,
            marketCap: 100,
            holdersCount: 300,
            bondingCurveProgress: 50,
            devHoldingPercentage: 5,
            topTenHoldingPercentage: 20,
            devHoldingPercentageCirculating: 20,
            topTenHoldingPercentageCirculating: 70,
            topHolderCirculatingPercentage: 12,
        };

        expect(shouldBuyStateless(buyConfig, marketContext)).toBe(true);
    });

    test('should return false when holdersCount is below the min range', () => {
        const buyConfig: LaunchpadStrategyBuyConfig = {
            holdersCount: { min: 100, max: 500 },
        };

        expect(
            shouldBuyStateless(
                buyConfig,
                formMarketContext({
                    holdersCount: 50, // Below min
                }),
            ),
        ).toBe(false);
    });

    test('should return false when bondingCurveProgress is above the max range', () => {
        const buyConfig: LaunchpadStrategyBuyConfig = {
            bondingCurveProgress: { min: 10, max: 90 },
        };

        expect(
            shouldBuyStateless(
                buyConfig,
                formMarketContext({
                    bondingCurveProgress: 95, // Above max
                }),
            ),
        ).toBe(false);
    });

    test('should return false when devHoldingPercentage is below min', () => {
        const buyConfig: LaunchpadStrategyBuyConfig = {
            devHoldingPercentage: { min: 5, max: 15 },
        };

        expect(
            shouldBuyStateless(
                buyConfig,
                formMarketContext({
                    devHoldingPercentage: 3, // Below min
                }),
            ),
        ).toBe(false);
    });

    test('should return true if config is empty (no constraints)', () => {
        const buyConfig: LaunchpadStrategyBuyConfig = {}; // No constraints

        expect(shouldBuyStateless(buyConfig, formMarketContext({}))).toBe(true);
    });

    test('should return false if any value is out of range', () => {
        const buyConfig: LaunchpadStrategyBuyConfig = {
            holdersCount: { min: 100, max: 500 },
            bondingCurveProgress: { min: 10, max: 90 },
            devHoldingPercentage: { min: 2, max: 10 },
            topTenHoldingPercentage: { min: 5, max: 50 },
        };

        expect(
            shouldBuyStateless(
                buyConfig,
                formMarketContext({
                    holdersCount: 600, // Exceeds max
                }),
            ),
        ).toBe(false);
    });
});

describe(checkInterval.name, () => {
    test('should return true when value is within range', () => {
        const config: IntervalConfig = { min: 10, max: 50 };
        expect(checkInterval(config, 30)).toBe(true); // 30 is within 10-50
    });

    test('should return false when value is below min', () => {
        const config: IntervalConfig = { min: 10, max: 50 };
        expect(checkInterval(config, 5)).toBe(false); // 5 is below min (10)
    });

    test('should return false when value is above max', () => {
        const config: IntervalConfig = { min: 10, max: 50 };
        expect(checkInterval(config, 55)).toBe(false); // 55 is above max (50)
    });

    test('should return true when value is exactly min', () => {
        const config: IntervalConfig = { min: 10, max: 50 };
        expect(checkInterval(config, 10)).toBe(true); // 10 is exactly min
    });

    test('should return true when value is exactly max', () => {
        const config: IntervalConfig = { min: 10, max: 50 };
        expect(checkInterval(config, 50)).toBe(true); // 50 is exactly max
    });

    test('should return true when only min is set and value is above min', () => {
        const config: IntervalConfig = { min: 10 };
        expect(checkInterval(config, 15)).toBe(true); // 15 is above min (10)
    });

    test('should return false when only min is set and value is below min', () => {
        const config: IntervalConfig = { min: 10 };
        expect(checkInterval(config, 5)).toBe(false); // 5 is below min (10)
    });

    test('should return true when only max is set and value is below max', () => {
        const config: IntervalConfig = { max: 50 };
        expect(checkInterval(config, 30)).toBe(true); // 30 is below max (50)
    });

    test('should return false when only max is set and value is above max', () => {
        const config: IntervalConfig = { max: 50 };
        expect(checkInterval(config, 60)).toBe(false); // 60 is above max (50)
    });

    test('should return true when config is undefined (no constraints)', () => {
        expect(checkInterval(undefined, 100)).toBe(true); // No constraints, should always return true
    });

    test('should return true when config is empty (no constraints)', () => {
        const config: IntervalConfig = {};
        expect(checkInterval(config, 100)).toBe(true); // No min or max, should always return true
    });

    test('should return true when the value is null and config is empty or undefined (no constraints)', () => {
        expect(checkInterval({}, null)).toBe(true);
        expect(checkInterval(undefined, null)).toBe(true);
    });

    test('should return false when the value is null and we have constrains', () => {
        const config: IntervalConfig = {
            min: 1,
        };
        expect(checkInterval(config, null)).toBe(false);
    });
});

describe(shouldExitLaunchpadToken.name, () => {
    const maxWaitMs = 7 * 60 * 1e3;

    const marketContext: MarketContext = formMarketContext({
        price: 100,
        marketCap: 200,
        holdersCount: 300,
        bondingCurveProgress: 50,
    });

    const launchpadBuyPosition: LaunchpadBuyPosition = {
        marketContext: marketContext,
        transaction: TradeTransactionFactory(),
    };

    it('should exit if mc is lower than initial and has not enough holders and bc', () => {
        const history = [
            formHistoryEntry({
                marketCap: 100,
                holdersCount: 200,
                bondingCurveProgress: 50,
            }),
            formHistoryEntry({
                marketCap: 93.5,
                holdersCount: 30,
                bondingCurveProgress: 35,
            }),
        ];
        expect(
            shouldExitLaunchpadToken(
                history[1],
                history,
                {
                    elapsedMonitoringMs: 5 * 60 * 1e3 + 1,
                },
                undefined,
                5 * 60 * 1e3,
            ),
        ).toEqual({
            exitCode: 'DUMPED',
            message:
                'Stopped monitoring token because it was probably dumped lower_mc_than_initial and current market cap is less than the initial one',
            shouldSell: false,
        });
    });

    /**
     * It will iterate over a set of mint results that were incorrectly marked as dumped
     * and make sure this doesn't happen still, or are marked dumped in another proper place
     */
    it.skip('should not exit if mc is lower than the initial one and token is still active', () => {
        const expected: Record<string, ShouldExitMonitoringResponse> = {
            '2KgiJvYxfcpjYao6uwrqiSphHgjdcVhDa61TrqSipump.json': false,
            '25PL8GBapUBncfrHnj9cPtSZ1A7hZnQ8fEAbvb1Hmdgr.json': false,
        };

        const fixturesLocalRelPath = 'common/dump-rebounds';
        const files = walkDirFilesSyncRecursive(localFixturesPath(fixturesLocalRelPath), []);
        const actual: typeof expected = {};

        for (const file of files) {
            const report = readLocalFixture<HandlePumpTokenBotReport>(`${fixturesLocalRelPath}/${file.name}`);
            let elapsedMonitoringMs = 0;
            let contextIndex = -1;
            for (let i = 0; i < report.history.length; i++) {
                const historyEntry = report.history[i];
                elapsedMonitoringMs = historyEntry.timestamp - report.history[i].timestamp;
                if (historyEntry._metadata && historyEntry._metadata.action === 'strategyExit') {
                    contextIndex = i;
                    break;
                }
            }

            actual[file.name] = shouldExitLaunchpadToken(
                report.history[contextIndex],
                report.history,
                {
                    elapsedMonitoringMs,
                },
                undefined,
                5 * 60 * 1e3,
            );
        }

        expect(actual).toEqual(expected);
    });

    it('should exit if the price is lower than start price', () => {
        expect(
            shouldExitLaunchpadToken(
                marketContext,
                [
                    formHistoryEntry({
                        timestamp: 1,
                        price: marketContext.price + 1,
                    }),
                ],
                {
                    elapsedMonitoringMs: 5 * 60 * 1e3 + 1,
                },
                undefined,
                5 * 60 * 1e3,
            ),
        ).toEqual({
            exitCode: 'DUMPED',
            message:
                'Stopped monitoring token because it was probably dumped lower_price_than_initial and current market cap is less than the initial one',
            shouldSell: false,
        });
    });

    it('should exit if time passed and no pump happened', () => {
        expect(
            shouldExitLaunchpadToken(
                marketContext,
                [
                    formHistoryEntry({
                        timestamp: 10,
                        price: 87,
                        marketCap: 100,
                        bondingCurveProgress: 25,
                        holdersCount: 15,
                    }),
                ],
                {
                    elapsedMonitoringMs: 5 * 60 * 1e3 + 1,
                },
                undefined,
                5 * 60 * 1e3,
            ),
        ).toEqual({
            exitCode: 'NO_PUMP',
            message: 'Stopped monitoring token. We waited 300.001 seconds and did not pump',
            shouldSell: false,
        });
    });

    const shouldExitItExitsArgs: [
        MarketContext,
        HistoryEntry[],
        {
            elapsedMonitoringMs: number;
        },
    ] = [
        formMarketContext({
            price: 3.1355480118319034e-8,
            marketCap: 30,
            holdersCount: 3,
            bondingCurveProgress: 50,
        }),
        [
            formHistoryEntry({
                timestamp: 10,
                // eslint-disable-next-line no-loss-of-precision
                price: 3.0355480118319034e-8,
                marketCap: 31.770000079,
                bondingCurveProgress: 25,
                holdersCount: 15,
                devHoldingPercentage: 10,
                topTenHoldingPercentage: 35,
            }),
        ],
        {
            elapsedMonitoringMs: 120 * 1e3 + 1,
        },
    ];

    it('should exit if token is dumped', () => {
        // @ts-ignore
        expect(shouldExitLaunchpadToken(...[...shouldExitItExitsArgs, undefined, maxWaitMs])).toEqual({
            exitCode: 'DUMPED',
            message:
                'Stopped monitoring token because it was probably dumped less_mc_and_few_holders and current market cap is less than the initial one',
            shouldSell: false,
        });
    });

    it('should exit if token is dumped and request sell when we have a position', () => {
        // @ts-ignore
        expect(shouldExitLaunchpadToken(...[...shouldExitItExitsArgs, launchpadBuyPosition, maxWaitMs])).toEqual({
            exitCode: 'DUMPED',
            message: 'The token is probably dumped less_mc_and_few_holders and we will sell at loss, sell=true',
            shouldSell: {
                reason: 'DUMPED',
            },
        });
    });

    it('should exit if token is dumped and holders now are less than before max', () => {
        expect(
            shouldExitLaunchpadToken(
                formMarketContext({
                    price: 3.1355480118319034e-8,
                    marketCap: 30.9,
                    holdersCount: 3,
                    bondingCurveProgress: 50,
                }),
                [
                    formHistoryEntry({
                        marketCap: 31,
                        holdersCount: 1,
                    }),
                    formHistoryEntry({
                        marketCap: 32,
                        holdersCount: 4,
                    }),
                    formHistoryEntry({
                        marketCap: 30.9,
                        holdersCount: 3,
                    }),
                ],
                {
                    elapsedMonitoringMs: 60 * 1e3,
                },
                undefined,
                maxWaitMs,
            ),
        ).toEqual({
            exitCode: 'DUMPED',
            message:
                'Stopped monitoring token because it was probably dumped less_holders_and_mc_than_initial and current market cap is less than the initial one',
            shouldSell: false,
        });
    });
});
