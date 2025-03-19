import { createLogger } from 'winston';

import * as pumpfun from '../../../../../../src/blockchains/solana/dex/pumpfun/Pumpfun';
import { PumpfunInitialCoinData } from '../../../../../../src/blockchains/solana/dex/pumpfun/types';
import { calculatePumpTokenLamportsValue } from '../../../../../../src/blockchains/solana/dex/pumpfun/utils';
import { TIP_LAMPORTS } from '../../../../../../src/blockchains/solana/Jito';
import { solToLamports } from '../../../../../../src/blockchains/utils/amount';
import PumpfunBacktester, {
    getNextEntryIndex,
} from '../../../../../../src/trading/bots/blockchains/solana/PumpfunBacktester';
import { BacktestRunConfig, BacktestTradeResponse } from '../../../../../../src/trading/bots/blockchains/solana/types';
import { HistoryEntry } from '../../../../../../src/trading/bots/launchpads/types';
import RiseStrategy, { RiseStrategyConfig } from '../../../../../../src/trading/strategies/launchpads/RiseStrategy';
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

    const runConfig: BacktestRunConfig = {
        initialBalanceLamports: solToLamports(1),
        buyAmountSol: 0.4,
        jitoConfig: {
            jitoEnabled: false,
        },
        strategy: riseStrategy,
        useRandomizedValues: true,
        onlyOneFullTrade: true,
        allowNegativeBalance: false,
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
            expect(r.maxDrawdown).toEqual(0);
        });

        it('should simulate buy execution time and skip to the next entry after a buy', async () => {
            simulatePumpBuyLatencyMsSpy.mockImplementation(() => {
                return 2;
            });

            const r = (await backtester.run(runConfig, tokenInfo, [
                {
                    // it will buy here as we set all conditions to match the strategy buy config
                    timestamp: 7,
                    price: 2.77,
                    marketCap: 150,
                    bondingCurveProgress: 25,
                    holdersCount: 15,
                    devHoldingPercentage: 10,
                    topTenHoldingPercentage: 35,
                },
                {
                    // a sell opportunity which will be missed due to simulating buy execution time
                    timestamp: 8,
                    price: 100,
                    marketCap: 150,
                    bondingCurveProgress: 25,
                    holdersCount: 15,
                    devHoldingPercentage: 10,
                    topTenHoldingPercentage: 35,
                },
                {
                    // it will sell here
                    timestamp: 10,
                    price: 87,
                    marketCap: 150,
                    bondingCurveProgress: 25,
                    holdersCount: 15,
                    devHoldingPercentage: 10,
                    topTenHoldingPercentage: 35,
                },
            ])) as BacktestTradeResponse;

            expect(r.tradeHistory.length).toEqual(2);
            expect(r.tradeHistory[0].transactionType).toEqual('buy');
            expect(r.tradeHistory[0].price.inSol).toEqual(2.77);
            expect(r.tradeHistory[1].transactionType).toEqual('sell');
            expect(r.tradeHistory[1].price.inSol).toEqual(87);
        });

        it('should return holdings amount and value after a buy if it cannot sell', async () => {
            const r = (await backtester.run(runConfig, tokenInfo, [
                {
                    // it will buy here as we set all conditions to match the strategy buy config
                    timestamp: 7,
                    price: 2.77,
                    marketCap: 150,
                    bondingCurveProgress: 25,
                    holdersCount: 15,
                    devHoldingPercentage: 10,
                    topTenHoldingPercentage: 35,
                },
                {
                    // won't sell here as sell conditions aren't met
                    timestamp: 8,
                    price: 2.77,
                    marketCap: 150,
                    bondingCurveProgress: 25,
                    holdersCount: 15,
                    devHoldingPercentage: 10,
                    topTenHoldingPercentage: 35,
                },
            ])) as BacktestTradeResponse;

            expect(r.tradeHistory.length).toEqual(1);
            expect(r.finalBalanceLamports).toBeLessThan(runConfig.initialBalanceLamports);
            expect(r.profitLossLamports).toBeCloseTo(r.tradeHistory[0].netTransferredLamports);
            expect(r.holdings.amountRaw).toEqual(r.tradeHistory[0].amountRaw);
            expect(r.holdings.lamportsValue).toEqual(solToLamports(runConfig.buyAmountSol));
            expect(r.roi).toBeLessThan(-20);
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
                useRandomizedValues: false,
                onlyOneFullTrade: false,
            },
            tokenInfo,
            [
                {
                    // it will buy here as we set all conditions to match the strategy buy config
                    timestamp: 7,
                    price: 2.77,
                    marketCap: 150,
                    bondingCurveProgress: 25,
                    holdersCount: 15,
                    devHoldingPercentage: 10,
                    topTenHoldingPercentage: 35,
                },
                {
                    // it will sell at huge loss here
                    timestamp: 8,
                    price: 0.2,
                    marketCap: 1.5,
                    bondingCurveProgress: 25,
                    holdersCount: 15,
                    devHoldingPercentage: 10,
                    topTenHoldingPercentage: 35,
                },
                {
                    // buy conditions meet here, but it must not buy as has no balance
                    timestamp: 9,
                    price: 2.75,
                    marketCap: 145,
                    bondingCurveProgress: 25,
                    holdersCount: 15,
                    devHoldingPercentage: 10,
                    topTenHoldingPercentage: 35,
                },
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
                useRandomizedValues: false,
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
                {
                    // it will buy here as we set all conditions to match the strategy buy config
                    timestamp: 7,
                    price: 2.77,
                    marketCap: 150,
                    bondingCurveProgress: 25,
                    holdersCount: 15,
                    devHoldingPercentage: 10,
                    topTenHoldingPercentage: 35,
                },
                {
                    // it will sell at huge loss here
                    timestamp: 8,
                    price: 0.2,
                    marketCap: 1.5,
                    bondingCurveProgress: 25,
                    holdersCount: 15,
                    devHoldingPercentage: 10,
                    topTenHoldingPercentage: 35,
                },
                {
                    // it will buy again here but this time should not use any pumpfun fee account
                    timestamp: 9,
                    price: 0.1,
                    marketCap: 145,
                    bondingCurveProgress: 25,
                    holdersCount: 15,
                    devHoldingPercentage: 10,
                    topTenHoldingPercentage: 35,
                },
                {
                    // it will do nothing here
                    timestamp: 10,
                    price: 0.1,
                    marketCap: 145,
                    bondingCurveProgress: 25,
                    holdersCount: 15,
                    devHoldingPercentage: 10,
                    topTenHoldingPercentage: 35,
                },
            ],
        )) as BacktestTradeResponse;

        expect(r).toEqual(
            readLocalFixture<BacktestTradeResponse>('pumpfun-backtester/multiple-buys-using-jito-response'),
        );
    });

    describe('should use properly randomized values', () => {
        it('for buy, sell slippage', async () => {
            const history: HistoryEntry[] = [
                {
                    // it will buy here as we set all conditions to match the strategy buy config
                    timestamp: 7,
                    price: 2.77,
                    marketCap: 150,
                    bondingCurveProgress: 25,
                    holdersCount: 15,
                    devHoldingPercentage: 10,
                    topTenHoldingPercentage: 35,
                },
                {
                    // it will sell here
                    timestamp: 8,
                    price: 5,
                    marketCap: 160,
                    bondingCurveProgress: 25,
                    holdersCount: 15,
                    devHoldingPercentage: 10,
                    topTenHoldingPercentage: 35,
                },
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

        it('for buy and sell execution times', async () => {
            simulatePumpBuyLatencyMsSpy.mockRestore();
            simulatePumpSellLatencyMsSpy.mockRestore();

            const history: HistoryEntry[] = [
                {
                    // it will buy here as we set all conditions to match the strategy buy config
                    timestamp: 7,
                    price: 2.77,
                    marketCap: 150,
                    bondingCurveProgress: 25,
                    holdersCount: 15,
                    devHoldingPercentage: 10,
                    topTenHoldingPercentage: 35,
                },
                {
                    // it might sell here
                    timestamp: 2300,
                    price: 5,
                    marketCap: 160,
                    bondingCurveProgress: 25,
                    holdersCount: 15,
                    devHoldingPercentage: 10,
                    topTenHoldingPercentage: 35,
                },
                {
                    // it might sell here
                    timestamp: 2555,
                    price: 4.7,
                    marketCap: 160,
                    bondingCurveProgress: 25,
                    holdersCount: 15,
                    devHoldingPercentage: 10,
                    topTenHoldingPercentage: 35,
                },
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
});

describe(getNextEntryIndex.name, () => {
    const commonHistoryEntry: Omit<HistoryEntry, 'timestamp'> = {
        price: 100,
        marketCap: 150,
        bondingCurveProgress: 10,
        holdersCount: 10,
        devHoldingPercentage: 10,
        topTenHoldingPercentage: 10,
    };

    it('should return the next index if it is past the next timestamp', () => {
        expect(
            getNextEntryIndex(
                [
                    {
                        timestamp: 5,
                        ...commonHistoryEntry,
                    },
                    {
                        timestamp: 11,
                        ...commonHistoryEntry,
                    },
                    {
                        timestamp: 14,
                        ...commonHistoryEntry,
                    },
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
                    {
                        timestamp: 5,
                        ...commonHistoryEntry,
                    },
                    {
                        timestamp: 11,
                        ...commonHistoryEntry,
                    },
                    {
                        timestamp: 14,
                        ...commonHistoryEntry,
                    },
                    {
                        timestamp: 17,
                        ...commonHistoryEntry,
                    },
                ],
                0,
                20,
            ),
        ).toEqual(3);
    });
});
