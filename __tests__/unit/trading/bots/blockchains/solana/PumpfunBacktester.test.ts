import { createLogger } from 'winston';

import * as pumpfun from '../../../../../../src/blockchains/solana/dex/pumpfun/Pumpfun';
import { PumpfunInitialCoinData } from '../../../../../../src/blockchains/solana/dex/pumpfun/types';
import { calculatePumpTokenLamportsValue } from '../../../../../../src/blockchains/solana/dex/pumpfun/utils';
import { TIP_LAMPORTS } from '../../../../../../src/blockchains/solana/Jito';
import { solToLamports } from '../../../../../../src/blockchains/utils/amount';
import PumpfunBacktester, {
    getClosestEntryIndex,
    getNextEntryIndex,
} from '../../../../../../src/trading/bots/blockchains/solana/PumpfunBacktester';
import {
    BacktestStrategyRunConfig,
    BacktestTradeResponse,
} from '../../../../../../src/trading/bots/blockchains/solana/types';
import { HistoryEntry } from '../../../../../../src/trading/bots/launchpads/types';
import RiseStrategy, { RiseStrategyConfig } from '../../../../../../src/trading/strategies/launchpads/RiseStrategy';
import { formHistoryEntry } from '../../../../../__utils/blockchains/solana';
import { readFixture, readLocalFixture } from '../../../../../__utils/data';

const originalDateNow = Date.now;

describe(PumpfunBacktester.name, () => {
    const silentLogger = createLogger({
        silent: true,
        transports: [],
    });
    let simulatePumpBuyLatencyMsSpy: jest.SpyInstance;
    let simulatePumpSellLatencyMsSpy: jest.SpyInstance;
    let backtester: PumpfunBacktester;

    const riseStrategy = new RiseStrategy(silentLogger, {
        buySlippageDecimal: 0.25,
        sellSlippageDecimal: 0.25,
        buy: {
            holdersCount: {
                min: 15,
            },
            bondingCurveProgress: {
                min: 25,
            },
            devHoldingPercentage: {
                max: 10,
            },
            topTenHoldingPercentage: {
                max: 35,
            },
        },
        sell: {
            trailingStopLossPercentage: 15,
            takeProfitPercentage: 15,
        },
    });

    const runConfig: BacktestStrategyRunConfig = {
        initialBalanceLamports: solToLamports(1),
        buyAmountSol: 0.4,
        jitoConfig: {
            jitoEnabled: false,
        },
        strategy: riseStrategy,
        randomization: {
            priorityFees: true,
            slippages: 'randomized',
            execution: true,
        },
        onlyOneFullTrade: true,
        sellUnclosedPositionsAtEnd: false,
    };

    const tokenInfo: PumpfunInitialCoinData = {
        mint: '5xNMMoEQcQiJQURE6DEwvHVt1jJsMTLrFmBHZoqpump',
        creator: '5toWw4R3RPV8KuA4VF4R153yJbwqrvqtU2cNzesiHjKW',
        createdTimestamp: 1740056496720,
        bondingCurve: 'BGrF4MKYiy5WnodhReU1ThqxkpFJfvqSGfVAkgFcTqaq',
        associatedBondingCurve: '5XMryrPBvant2bZ4zweqFfiEggu4PBhbWZi7St8cRfNo',
        name: 'Oracle Framework',
        symbol: 'ORACLE',
        description: 'oracle framework is the easiest way to bring your agent to life. ',
        image: 'https://ipfs.io/ipfs/Qme4SLfMZbbwr1bvoLy5WCGwJGE68GBMBqKJw2ng4nMswB',
        twitter: 'https://x.com/oracleframework',
        telegram: 'https://t.me/oracleframeworkmeme',
        website: 'http://oracleframework.ai',
    };

    beforeEach(() => {
        backtester = new PumpfunBacktester(silentLogger);

        let startDateMs = 1616175600000;
        // @ts-ignore
        jest.spyOn(Date, 'now').mockImplementation(() => startDateMs++);

        // @ts-ignore
        simulatePumpBuyLatencyMsSpy = jest.spyOn(pumpfun, 'simulatePumpBuyLatencyMs').mockImplementation(() => {
            return 1;
        });
        // @ts-ignore
        simulatePumpSellLatencyMsSpy = jest.spyOn(pumpfun, 'simulatePumpSellLatencyMs').mockImplementation(() => {
            return 1;
        });
    });

    afterEach(() => {
        jest.resetAllMocks();
        riseStrategy.resetState();
        Date.now = originalDateNow;
    });

    describe('should work with onlyOneFullTrade enabled', () => {
        it('should make only one buy and sell and be profitable with this mint', async () => {
            const r = (await backtester.run(
                runConfig,
                tokenInfo,
                readFixture<{ history: HistoryEntry[] }>('backtest/pumpfun/5xNMMoEQcQiJQURE6DEwvHVt1jJsMTLrFmBHZoqpump')
                    .history,
            )) as BacktestTradeResponse;

            expect(r.tradeHistory.length).toEqual(2);
            expect(r.tradeHistory[0]).toEqual(
                expect.objectContaining({
                    timestamp: expect.any(Number),
                    transactionType: 'buy',
                    subCategory: 'newPosition',
                    transactionHash: expect.any(String),
                    amountRaw: expect.any(Number),
                    grossTransferredLamports: expect.any(Number),
                    netTransferredLamports: expect.any(Number),
                    price: {
                        inLamports: expect.any(Number),
                        inSol: expect.any(Number),
                    },
                    marketCap: expect.any(Number),
                }),
            );
            expect(r.tradeHistory[0].grossTransferredLamports).toBeLessThan(0);
            expect(r.tradeHistory[0].netTransferredLamports).toBeLessThan(0);
            expect(r.tradeHistory[1]).toEqual(
                expect.objectContaining({
                    timestamp: expect.any(Number),
                    transactionType: 'sell',
                    subCategory: 'sellAll',
                    transactionHash: expect.any(String),
                    amountRaw: expect.any(Number),
                    grossTransferredLamports: expect.any(Number),
                    netTransferredLamports: expect.any(Number),
                    price: {
                        inLamports: expect.any(Number),
                        inSol: expect.any(Number),
                    },
                    marketCap: expect.any(Number),
                }),
            );
            expect(r.tradeHistory[1].grossTransferredLamports).toBeGreaterThan(0);
            expect(r.tradeHistory[1].netTransferredLamports).toBeGreaterThan(0);
            expect(r.finalBalanceLamports).toBeGreaterThan(runConfig.initialBalanceLamports);
            expect(r.profitLossLamports).toBeGreaterThan(0);
            expect(r.holdings.amountRaw).toEqual(0);
            expect(r.roi).toBeGreaterThan(9);

            expect(r.tradeHistory[0].amountRaw).toEqual(r.tradeHistory[1].amountRaw);
            expect(r.tradeHistory[0].netTransferredLamports + r.tradeHistory[1].netTransferredLamports).toBeCloseTo(
                r.profitLossLamports,
            );
            expect(r.tradeHistory[1].price.inLamports).toBeGreaterThan(r.tradeHistory[0].price.inLamports);
            expect(r.tradeHistory[1].marketCap).toBeGreaterThan(r.tradeHistory[0].marketCap);
        });

        it('should not buy if it has not enough balance', async () => {
            const r = (await backtester.run(
                {
                    ...runConfig,
                    initialBalanceLamports: 1,
                },
                tokenInfo,
                readFixture<{ history: HistoryEntry[] }>('backtest/pumpfun/5xNMMoEQcQiJQURE6DEwvHVt1jJsMTLrFmBHZoqpump')
                    .history,
            )) as BacktestTradeResponse;

            expect(r.tradeHistory.length).toEqual(0);
            expect(r.finalBalanceLamports).toEqual(1);
            expect(r.profitLossLamports).toEqual(0);
            expect(r.holdings).toEqual({
                amountRaw: 0,
                lamportsValue: 0,
            });
            expect(r.roi).toEqual(0);
            expect(r.maxDrawdownPercentage).toEqual(0);
        });

        it('should simulate buy execution time and skip to the next entry after a buy', async () => {
            simulatePumpBuyLatencyMsSpy.mockImplementation(() => {
                return 2;
            });

            const r = (await backtester.run(runConfig, tokenInfo, [
                formHistoryEntry(
                    // it will buy here as we set all conditions to match the strategy buy config
                    {
                        timestamp: 7,
                        price: 2.77,
                    },
                ),
                formHistoryEntry(
                    // a sell opportunity which will be missed due to simulating buy execution time
                    {
                        timestamp: 8,
                        price: 100,
                    },
                ),
                formHistoryEntry(
                    // it will sell here
                    {
                        timestamp: 10,
                        price: 87,
                    },
                ),
            ])) as BacktestTradeResponse;

            expect(r.tradeHistory.length).toEqual(2);
            expect(r.tradeHistory[0].transactionType).toEqual('buy');
            expect(r.tradeHistory[0].price.inSol).toEqual(2.77);
            expect(r.tradeHistory[1].transactionType).toEqual('sell');
            expect(r.tradeHistory[1].price.inSol).toEqual(87);
        });

        const historyWhereShouldHaveHoldings: HistoryEntry[] = [
            formHistoryEntry({
                // it will buy here as we set all conditions to match the strategy buy config
                timestamp: 7,
                price: 2.77,
            }),
            formHistoryEntry({
                // won't sell here as sell conditions aren't met
                timestamp: 8,
                price: 2.78,
            }),
        ];

        it('should return holdings amount and value after a buy if it cannot sell', async () => {
            const r = (await backtester.run(
                runConfig,
                tokenInfo,
                historyWhereShouldHaveHoldings,
            )) as BacktestTradeResponse;

            expect(r.tradeHistory.length).toEqual(1);
            expect(r.finalBalanceLamports).toBeLessThan(runConfig.initialBalanceLamports);
            expect(r.profitLossLamports).toBeCloseTo(r.tradeHistory[0].netTransferredLamports);
            expect(r.holdings.amountRaw).toEqual(r.tradeHistory[0].amountRaw);
            expect(r.holdings.lamportsValue).toEqual(401444043.3212996);
            expect(r.roi).toBeLessThan(-20);
        });

        it('should sell all unclosed positions at the end when sellUnclosedPositionsAtEnd is true', async () => {
            const r = (await backtester.run(
                {
                    ...runConfig,
                    randomization: {
                        priorityFees: false,
                        slippages: 'off',
                        execution: false,
                    },
                    sellUnclosedPositionsAtEnd: true,
                },
                tokenInfo,
                historyWhereShouldHaveHoldings,
            )) as BacktestTradeResponse;

            expect(r.tradeHistory.length).toEqual(2);
            expect(r.tradeHistory[0].transactionType).toEqual('buy');
            expect(r.tradeHistory[1].transactionType).toEqual('sell');
            expect(r.tradeHistory[1].price).toEqual({
                inLamports: 2780000000,
                inSol: 2.78,
            });
            expect(r.tradeHistory[1].metadata).toEqual({
                historyRef: {
                    index: 1,
                    timestamp: 8,
                },
                pumpMinLamportsOutput: 144404.3321299639,
                reason: 'BEFORE_EXIT_MONITORING',
                sellPriceInSol: 2.085,
            });
        });
    });

    it('should stop after the first buy when it has no more balance and no buy position', async () => {
        const r = (await backtester.run(
            {
                ...runConfig,
                initialBalanceLamports: solToLamports(0.7),
                jitoConfig: {
                    jitoEnabled: true,
                    tipLamports: TIP_LAMPORTS,
                },
                randomization: {
                    priorityFees: false,
                    slippages: 'off',
                    execution: false,
                },
                onlyOneFullTrade: false,
            },
            tokenInfo,
            [
                formHistoryEntry({
                    // it will buy here as we set all conditions to match the strategy buy config
                    timestamp: 7,
                    price: 2.77,
                    marketCap: 150,
                }),
                formHistoryEntry({
                    // it will sell at huge loss here
                    timestamp: 8,
                    price: 0.2,
                    marketCap: 1.5,
                }),
                formHistoryEntry({
                    // buy conditions meet here, but it must not buy as has no balance
                    timestamp: 9,
                    price: 2.75,
                    marketCap: 145,
                }),
            ],
        )) as BacktestTradeResponse;

        expect(r).toEqual(
            readLocalFixture<BacktestTradeResponse>('pumpfun-backtester/stops-after-buy-due-to-no-funds-response'),
        );
    });

    it('should factor in Jito tip when enabled in amount calculations and use slippage and priority fees specified in the strategy config, without randomized values', async () => {
        const strategyConfig: Partial<RiseStrategyConfig> = {
            ...riseStrategy.config,
            buySlippageDecimal: 0.15,
            sellSlippageDecimal: 0.25,
            buyPriorityFeeInSol: 0.007,
            sellPriorityFeeInSol: 0.005,
        };
        const jitoTipLamports = 250000;

        const r = (await backtester.run(
            {
                ...runConfig,
                randomization: {
                    priorityFees: false,
                    slippages: 'off',
                    execution: false,
                },
                jitoConfig: {
                    jitoEnabled: true,
                    tipLamports: jitoTipLamports,
                },
                strategy: new RiseStrategy(silentLogger, {
                    ...riseStrategy.config,
                    ...strategyConfig,
                }),
                onlyOneFullTrade: false,
            },
            tokenInfo,
            [
                formHistoryEntry({
                    // it will buy here as we set all conditions to match the strategy buy config
                    timestamp: 7,
                    price: 2.77,
                    marketCap: 150,
                }),
                formHistoryEntry({
                    // it will sell at profit here
                    timestamp: 8,
                    price: 7,
                    marketCap: 1.5,
                }),
                formHistoryEntry({
                    // it will buy again here but this time should not use any pumpfun fee account
                    timestamp: 9,
                    price: 0.1,
                    marketCap: 145,
                }),
                formHistoryEntry({
                    // it will do nothing here
                    timestamp: 10,
                    price: 0.1,
                    marketCap: 145,
                }),
            ],
        )) as BacktestTradeResponse;

        expect(r).toEqual(
            readLocalFixture<BacktestTradeResponse>('pumpfun-backtester/multiple-buys-using-jito-response'),
        );
    });

    describe('should use properly randomized values', () => {
        it('for buy and sell slippages using randomized mode', async () => {
            const history: HistoryEntry[] = [
                formHistoryEntry({
                    // it will buy here as we set all conditions to match the strategy buy config
                    timestamp: 7,
                    price: 2.77,
                    marketCap: 150,
                }),
                formHistoryEntry({
                    // it will sell here
                    timestamp: 8,
                    price: 5,
                    marketCap: 160,
                }),
            ];

            for (let i = 0; i < 100; i++) {
                const r = (await backtester.run(runConfig, tokenInfo, history)) as BacktestTradeResponse;

                expect(r.tradeHistory.length).toEqual(2);

                expect(r.tradeHistory[0]).toEqual(
                    expect.objectContaining({
                        timestamp: expect.any(Number),
                        transactionType: 'buy',
                        subCategory: 'newPosition',
                        transactionHash: expect.any(String),
                        amountRaw: expect.any(Number),
                        price: {
                            inLamports: 2.77 * 1e9,
                            inSol: 2.77,
                        },
                        marketCap: 150,
                    }),
                );
                const buyAmountLamports = solToLamports(runConfig.buyAmountSol);
                expect(r.tradeHistory[0].grossTransferredLamports).toBeGreaterThanOrEqual(
                    -(
                        buyAmountLamports * (1 + riseStrategy.config.buySlippageDecimal) +
                        PumpfunBacktester.PumpfunAccountCreationFeeLamports
                    ),
                );
                expect(r.tradeHistory[0].grossTransferredLamports).toBeLessThanOrEqual(
                    -(buyAmountLamports + PumpfunBacktester.PumpfunAccountCreationFeeLamports),
                );

                expect(r.tradeHistory[1]).toEqual(
                    expect.objectContaining({
                        timestamp: expect.any(Number),
                        transactionType: 'sell',
                        subCategory: 'sellAll',
                        transactionHash: expect.any(String),
                        amountRaw: expect.any(Number),
                        grossTransferredLamports: expect.any(Number),
                        netTransferredLamports: expect.any(Number),
                        price: {
                            inLamports: 5 * 1e9,
                            inSol: 5,
                        },
                        marketCap: 160,
                    }),
                );
                expect(r.tradeHistory[1].grossTransferredLamports).toBeGreaterThanOrEqual(
                    calculatePumpTokenLamportsValue(r.tradeHistory[0].amountRaw, 5) *
                        (1 - riseStrategy.config.sellSlippageDecimal),
                );
                expect(r.tradeHistory[1].grossTransferredLamports).toBeLessThanOrEqual(
                    calculatePumpTokenLamportsValue(r.tradeHistory[0].amountRaw, 5),
                );
            }
        });

        it('for buy and sell slippages using closestEntry mode', async () => {
            simulatePumpBuyLatencyMsSpy.mockImplementation(() => 4);
            simulatePumpSellLatencyMsSpy.mockImplementation(() => 4);

            const history: HistoryEntry[] = [
                formHistoryEntry({
                    // it will buy here as we set all conditions to match the strategy buy config
                    timestamp: 7,
                    price: 2.77,
                    marketCap: 150,
                }),
                // normally should sell but this timestamp is skipped as we have 2 time for buy
                // should use the price here as buy price as ot os closer
                formHistoryEntry({
                    timestamp: 8,
                    price: 3.2132,
                    marketCap: 151,
                }),
                formHistoryEntry({
                    // it will start to sell here but use the time price for the next timestamp as it is closer to the next timestamp calculated by using the simulated sell time
                    timestamp: 20,
                    price: 5,
                    marketCap: 160,
                }),
                formHistoryEntry({
                    // it will do nothing here but just use this price for selling
                    timestamp: 22,
                    price: 5.1,
                    marketCap: 161,
                }),
            ];

            expect(
                await backtester.run(
                    {
                        ...runConfig,
                        randomization: {
                            priorityFees: false,
                            slippages: 'closestEntry',
                            execution: false,
                        },
                    },
                    tokenInfo,
                    history,
                ),
            ).toEqual(
                readLocalFixture<BacktestTradeResponse>(
                    'pumpfun-backtester/trade-response-with-closestEntry-slippages',
                ),
            );
        });

        it('for buy and sell execution times', async () => {
            simulatePumpBuyLatencyMsSpy.mockRestore();
            simulatePumpSellLatencyMsSpy.mockRestore();

            const history: HistoryEntry[] = [
                formHistoryEntry({
                    // it will buy here as we set all conditions to match the strategy buy config
                    timestamp: 7,
                    price: 2.77,
                    marketCap: 150,
                }),
                formHistoryEntry({
                    // it might sell here
                    timestamp: 2300,
                    price: 5,
                    marketCap: 160,
                }),
                formHistoryEntry({
                    // it might sell here
                    timestamp: 2555,
                    price: 4.7,
                    marketCap: 160,
                }),
            ];

            let foundFirstSellPossibility = false;
            let foundSecondSellPossibility = false;

            for (let i = 0; i < 100; i++) {
                const r = (await backtester.run(runConfig, tokenInfo, history)) as BacktestTradeResponse;

                expect(r.tradeHistory.length).toEqual(2);

                expect(r.tradeHistory[0]).toEqual(
                    expect.objectContaining({
                        timestamp: expect.any(Number),
                        transactionType: 'buy',
                        subCategory: 'newPosition',
                        transactionHash: expect.any(String),
                        amountRaw: expect.any(Number),
                        price: {
                            inLamports: 2.77 * 1e9,
                            inSol: 2.77,
                        },
                        marketCap: 150,
                    }),
                );
                const buyAmountLamports = solToLamports(runConfig.buyAmountSol);
                expect(r.tradeHistory[0].grossTransferredLamports).toBeGreaterThanOrEqual(
                    -(
                        buyAmountLamports * (1 + riseStrategy.config.buySlippageDecimal) +
                        PumpfunBacktester.PumpfunAccountCreationFeeLamports
                    ),
                );
                expect(r.tradeHistory[0].grossTransferredLamports).toBeLessThanOrEqual(
                    -(buyAmountLamports + PumpfunBacktester.PumpfunAccountCreationFeeLamports),
                );
                expect(r.tradeHistory[1]).toEqual(
                    expect.objectContaining({
                        timestamp: expect.any(Number),
                        transactionType: 'sell',
                        subCategory: 'sellAll',
                        transactionHash: expect.any(String),
                        amountRaw: expect.any(Number),
                        grossTransferredLamports: expect.any(Number),
                        netTransferredLamports: expect.any(Number),
                    }),
                );
                if (r.tradeHistory[1].price.inSol === 5) {
                    foundFirstSellPossibility = true;
                } else if (r.tradeHistory[1].price.inSol === 4.7) {
                    foundSecondSellPossibility = true;
                }
            }

            expect(foundFirstSellPossibility).toBeTruthy();
            expect(foundSecondSellPossibility).toBeTruthy();
        });
    });

    it('should exit when the strategy requires so', async () => {
        const history: HistoryEntry[] = [
            // does nothing
            formHistoryEntry({
                marketCap: 30,
                holdersCount: 1,
            }),
            // does nothing
            formHistoryEntry({
                marketCap: 50,
                holdersCount: 1,
            }),
            // token is dumped and strategy.shouldExit will be true and sell false as we haven't bought anything
            formHistoryEntry({
                marketCap: 27,
                holdersCount: 1,
            }),
        ];

        expect(await backtester.run(runConfig, tokenInfo, history)).toEqual({
            exitCode: 'DUMPED',
            exitReason:
                'Stopped monitoring token because it was probably dumped lower_mc_than_initial and current market cap is less than the initial one',
        });
    });
});

describe(getNextEntryIndex.name, () => {
    it('should return the next index if it is past the next timestamp', () => {
        expect(
            getNextEntryIndex(
                [
                    formHistoryEntry({
                        timestamp: 5,
                    }),
                    formHistoryEntry({
                        timestamp: 11,
                    }),
                    formHistoryEntry({
                        timestamp: 14,
                    }),
                ],
                0,
                11,
            ),
        ).toEqual(1);
    });

    it('should return the last index if the the next ones are not past next timestamp', () => {
        expect(
            getNextEntryIndex(
                [
                    formHistoryEntry({
                        timestamp: 5,
                    }),
                    formHistoryEntry({
                        timestamp: 11,
                    }),
                    formHistoryEntry({
                        timestamp: 14,
                    }),
                    formHistoryEntry({
                        timestamp: 17,
                    }),
                ],
                0,
                20,
            ),
        ).toEqual(3);
    });
});

describe(getClosestEntryIndex.name, () => {
    it('should return the current index because it is closer to the nextTimestamp than the next one', () => {
        expect(
            getClosestEntryIndex(
                [
                    formHistoryEntry({
                        timestamp: 5,
                    }),
                    formHistoryEntry({
                        timestamp: 11,
                    }),
                    formHistoryEntry({
                        timestamp: 20,
                    }),
                ],
                1,
                13,
            ),
        ).toEqual(1);
    });

    it('should return the immediate next index because it is closer to the nextTimestamp', () => {
        expect(
            getClosestEntryIndex(
                [
                    formHistoryEntry({
                        timestamp: 5,
                    }),
                    formHistoryEntry({
                        timestamp: 11,
                    }),
                    formHistoryEntry({
                        timestamp: 15,
                    }),
                ],
                1,
                13,
            ),
        ).toEqual(2);
    });

    it('should return the next index if the current index and next one have same timestamp difference from nextTimestamp', () => {
        expect(
            getClosestEntryIndex(
                [
                    formHistoryEntry({
                        timestamp: 1,
                    }),
                    formHistoryEntry({
                        timestamp: 5,
                    }),
                    formHistoryEntry({
                        timestamp: 15,
                    }),
                ],
                1,
                10,
            ),
        ).toEqual(2);
    });
});
