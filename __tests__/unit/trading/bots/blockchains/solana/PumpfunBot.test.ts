import { LogEntry, createLogger, format } from 'winston';

import { measureExecutionTime } from '../../../../../../src/apm/apm';
import { BASE_FEE_LAMPORTS } from '../../../../../../src/blockchains/solana/constants/core';
import { SolanaWalletProviders } from '../../../../../../src/blockchains/solana/constants/walletProviders';
import { PUMPFUN_TOKEN_DECIMALS } from '../../../../../../src/blockchains/solana/dex/pumpfun/constants';
import { pumpCoinDataToInitialCoinData } from '../../../../../../src/blockchains/solana/dex/pumpfun/mappers/mappers';
import Pumpfun from '../../../../../../src/blockchains/solana/dex/pumpfun/Pumpfun';
import PumpfunMarketContextProvider from '../../../../../../src/blockchains/solana/dex/pumpfun/PumpfunMarketContextProvider';
import {
    PumpFunCoinData,
    PumpfunBuyResponse,
    PumpfunSellResponse,
} from '../../../../../../src/blockchains/solana/dex/pumpfun/types';
import { sellPumpfunTokensWithRetries } from '../../../../../../src/blockchains/solana/dex/pumpfun/utils';
import SolanaAdapter from '../../../../../../src/blockchains/solana/SolanaAdapter';
import { SolTransactionDetails } from '../../../../../../src/blockchains/solana/types';
import { solanaConnection } from '../../../../../../src/blockchains/solana/utils/connection';
import { simulateSolTransactionDetails } from '../../../../../../src/blockchains/solana/utils/simulations';
import Wallet from '../../../../../../src/blockchains/solana/Wallet';
import { solToLamports } from '../../../../../../src/blockchains/utils/amount';
import { closePosition, insertPosition } from '../../../../../../src/db/repositories/positions';
import { Blockchain, InsertPosition } from '../../../../../../src/db/types';
import ArrayTransport from '../../../../../../src/logger/transports/ArrayTransport';
import PumpfunBot from '../../../../../../src/trading/bots/blockchains/solana/PumpfunBot';
import PumpfunBotEventBus from '../../../../../../src/trading/bots/blockchains/solana/PumpfunBotEventBus';
import {
    BotTradeResponse,
    PumpfunBuyPositionMetadata,
    PumpfunSellPositionMetadata,
    TradeTransaction,
} from '../../../../../../src/trading/bots/blockchains/solana/types';
import { MarketContext } from '../../../../../../src/trading/bots/launchpads/types';
import { BotConfig } from '../../../../../../src/trading/bots/types';
import RiseStrategy from '../../../../../../src/trading/strategies/launchpads/RiseStrategy';
import StupidSniperStrategy from '../../../../../../src/trading/strategies/launchpads/StupidSniperStrategy';
import { generateTradeId } from '../../../../../../src/trading/utils/generateTradeId';
import { formMarketContext } from '../../../../../__utils/blockchains/solana';
import { readFixture, readLocalFixture } from '../../../../../__utils/data';
import { FullTestExpectation, FullTestMultiCaseExpectation, MultiCaseFixture } from '../../../../../__utils/types';
import { TxWithIllegalOwnerError } from '../../../../blockchains/solana/utils/transactions.test';

jest.mock('../../../../../../src/apm/apm');

jest.mock('../../../../../../src/trading/bots/blockchains/solana/PumpfunBotEventBus');

jest.mock('../../../../../../src/blockchains/solana/dex/pumpfun/PumpfunMarketContextProvider');

jest.mock('../../../../../../src/blockchains/solana/dex/pumpfun/Pumpfun');

jest.mock('../../../../../../src/db/repositories/positions');

jest.mock('../../../../../../src/utils/functions', () => ({
    ...jest.requireActual('../../../../../../src/utils/functions'),
    sleep: jest.fn(),
}));

jest.mock('../../../../../../src/trading/utils/generateTradeId');

jest.mock('../../../../../../src/blockchains/solana/dex/pumpfun/utils', () => ({
    ...jest.requireActual('../../../../../../src/blockchains/solana/dex/pumpfun/utils'),
    sellPumpfunTokensWithRetries: jest.fn(),
}));

const originalDateNow = Date.now;

describe(PumpfunBot.name, () => {
    let logs: LogEntry[] = [];
    const logger = createLogger({
        level: 'silly',
    });
    const pumpfun = new Pumpfun({
        rpcEndpoint: process.env.SOLANA_RPC_ENDPOINT as string,
        wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
    });
    const solanaAdapter = new SolanaAdapter(solanaConnection);
    const marketContextProvider = new PumpfunMarketContextProvider(pumpfun, solanaAdapter, {
        measureExecutionTime: true,
    });
    const wallet = new Wallet(solanaConnection, {
        provider: SolanaWalletProviders.TrustWallet,
        mnemonic: process.env.WALLET_MNEMONIC_PHRASE as string,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wallet as any)._privateKey = 'mocked-private-key';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wallet as any)._address = 'mocked-address';
    const botEventBus = new PumpfunBotEventBus();
    const botConfig: BotConfig = {
        simulate: true,
        buyMonitorWaitPeriodMs: 2500,
        sellMonitorWaitPeriodMs: 250,
        maxWaitMonitorAfterResultMs: 3 * 1e3,
        buyInSol: 0.4,
    };

    let pumpfunBot: PumpfunBot;

    beforeEach(() => {
        logs = [];
        logger.clear().add(new ArrayTransport({ array: logs, json: true, format: format.splat() }));

        let startDateMs = 1616175600000;
        // @ts-ignore
        jest.spyOn(Date, 'now').mockImplementation(() => (startDateMs += 1e3));

        pumpfunBot = new PumpfunBot({
            logger: logger,
            pumpfun: pumpfun,
            solanaAdapter: solanaAdapter,
            marketContextProvider: marketContextProvider,
            wallet: wallet,
            config: botConfig,
            botEventBus,
        });

        (generateTradeId as jest.Mock).mockImplementation((blockchain: Blockchain, assetSymbol) => {
            const tradeId = `${blockchain}-${assetSymbol}-test-${Date.now()}`;
            if (tradeId.length > 50) {
                return tradeId.slice(0, 50);
            }

            return tradeId;
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
        Date.now = originalDateNow;
        (marketContextProvider.get as jest.Mock).mockReset();
    });

    it('should fail to construct when buyMonitorWaitPeriodMs is not a multiple of sellMonitorWaitPeriodMs', () => {
        expect(() => {
            new PumpfunBot({
                logger: logger,
                pumpfun: pumpfun,
                solanaAdapter: solanaAdapter,
                marketContextProvider: marketContextProvider,
                wallet: wallet,
                config: {
                    ...botConfig,
                    buyMonitorWaitPeriodMs: 1100,
                    sellMonitorWaitPeriodMs: 500,
                },
                botEventBus,
            });
        }).toThrow(new Error('buyMonitorWaitPeriodMs must be a multiple of sellMonitorWaitPeriodMs.'));
    });

    const initialCoinData = pumpCoinDataToInitialCoinData(readFixture<PumpFunCoinData>('dex/pumpfun/get-coin-data'));

    const dummyPumpfunBuyResponse: PumpfunBuyResponse = {
        signature: '3iDf5i1MpqRMPfvvQCyy2U1DZVngaMGRRcNCpbZT1R5DEnjTBQtb6n1qhttf1fECMLbUqG7s3K8AYRA2ghhzM7Nx',
        boughtAmountRaw: 10499526567337,
        pumpTokenOut: 10499526567337,
        pumpMaxSolCost: 0.55,
        txDetails: simulateSolTransactionDetails(solToLamports(0.42), solToLamports(0.005)),
    };

    const dummyPumpfunSellResponse: PumpfunSellResponse = {
        signature: '4qADGbGKY7C26ZEb7CKMEbkCvSbo3Ybf9R6Lqqx1HyBYjyt5AK8WEQmy76EcAM9NDBKur8Vqk3ZH5XES28U1DxBB',
        soldRawAmount: 10499526567337,
        minLamportsOutput: solToLamports(0.71),
        txDetails: simulateSolTransactionDetails(solToLamports(0.67), solToLamports(0.005)),
    };

    /**
     * should buy and sell using strategy defined priority fees and slippages for buy and sell
     * should not try to buy while one buy is already in progress
     * should respect maxWaitMonitorAfterResultMs
     * should return BotTradeResponse with the correct data
     *
     */
    it('1 - should perform fine a single buy and sell using strategy defined priorities and slippages and return BotTradeResponse', async () => {
        const strategy = new StupidSniperStrategy(logger, {
            buySlippageDecimal: 0.1,
            sellSlippageDecimal: 0.25,
            buyPriorityFeeInSol: 0.005,
            sellPriorityFeeInSol: 0.001,
            sell: {
                takeProfitPercentage: 10,
                trailingStopLossPercentage: 25,
            },
        });

        const expected = readLocalFixture<FullTestExpectation>('pumpfun-bot/1-single-buy-sell');
        const expectedBotTradeResponse = expected.result as BotTradeResponse;
        const expectedBuyTradeTransaction = expectedBotTradeResponse.transactions.find(
            e => e.transactionType === 'buy',
        )! as TradeTransaction<PumpfunBuyPositionMetadata>;
        const expectedSellTradeTransaction = expectedBotTradeResponse.transactions.find(
            e => e.transactionType === 'sell',
        )! as TradeTransaction<PumpfunSellPositionMetadata>;

        const mockReturnedMarketContexts: MarketContext[] = [
            formMarketContext({
                // it will buy here
                price: 3.1e-8,
            }),
            formMarketContext({
                // it will do nothing here
                price: 3.12e-8,
            }),
            formMarketContext({
                // it will do nothing here
                price: 3.13e-8,
            }),
            formMarketContext({
                // it will do nothing here
                price: 3.14e-8,
            }),
            formMarketContext({
                // it will sell here
                price: 3.41e-8,
            }),
            // fill at least maxWaitMonitorAfterResultSeconds + 1 values just so it does nothing but checks for the maxWaitMonitorAfterResultMs
            ...Array(4)
                .fill(0)
                .map((_, i) =>
                    formMarketContext({
                        price: (3.42 + i / 100) * 1e-8,
                    }),
                ),
        ];
        mockReturnedMarketContexts.forEach(mr => (marketContextProvider.get as jest.Mock).mockResolvedValueOnce(mr));

        const mockReturnedPumpfunBuyResponse: PumpfunBuyResponse = {
            signature: expectedBuyTradeTransaction.transactionHash,
            boughtAmountRaw: expectedBuyTradeTransaction.amountRaw,
            pumpTokenOut: expectedBuyTradeTransaction.metadata!.pumpTokenOut,
            pumpMaxSolCost: expectedBuyTradeTransaction.metadata!.pumpMaxSolCost,
            txDetails: simulateSolTransactionDetails(
                expectedBuyTradeTransaction.grossTransferredLamports,
                solToLamports(strategy.config.buyPriorityFeeInSol!),
            ),
        };
        (pumpfun.buy as jest.Mock).mockResolvedValue(mockReturnedPumpfunBuyResponse);
        (insertPosition as jest.Mock).mockResolvedValue(undefined);

        const mockReturnedPumpfunSellResponse: PumpfunSellResponse = {
            signature: expectedSellTradeTransaction.transactionHash,
            soldRawAmount: expectedSellTradeTransaction.amountRaw,
            minLamportsOutput: expectedSellTradeTransaction.metadata!.pumpMinLamportsOutput,
            txDetails: simulateSolTransactionDetails(
                expectedSellTradeTransaction.grossTransferredLamports,
                strategy.config.sellPriorityFeeInSol!,
            ),
        };
        (pumpfun.sell as jest.Mock).mockResolvedValue(mockReturnedPumpfunSellResponse);
        (closePosition as jest.Mock).mockResolvedValue(undefined);

        const actual = await pumpfunBot.run('a', initialCoinData, strategy);
        expect(actual).toEqual(expectedBotTradeResponse);

        expect(marketContextProvider.get as jest.Mock).toHaveBeenCalledTimes(9);
        expect(marketContextProvider.get as jest.Mock).toHaveBeenCalledWith({
            tokenMint: initialCoinData.mint,
            bondingCurve: initialCoinData.bondingCurve,
            creator: initialCoinData.creator,
        });

        expect((measureExecutionTime as jest.Mock).mock.calls[0][1]).toEqual(
            'pumpfun.buy_simulation_0.005_jito_0.00015',
        );
        expect(pumpfun.buy).toHaveBeenCalledTimes(1);
        expect(pumpfun.buy).toHaveBeenCalledWith({
            transactionMode: 0,
            payerPrivateKey: wallet.privateKey,
            tokenMint: initialCoinData.mint,
            tokenBondingCurve: initialCoinData.bondingCurve,
            tokenAssociatedBondingCurve: initialCoinData.associatedBondingCurve,
            solIn: botConfig.buyInSol,
            priorityFeeInSol: 0.005,
            slippageDecimal: 0.1,
            jitoConfig: {
                jitoEnabled: true,
            },
        });
        expect(insertPosition).toHaveBeenCalledTimes(1);
        const expectedInsertPosition: InsertPosition = {
            mode: 'simulation',
            trade_id: 'solana-MMC-test-1616175607000',
            chain: 'solana',
            exchange: 'pumpfun',
            user_address: 'mocked-address',
            asset_mint: '3sjp1tih7e7pc1ehvxBDzpYiymGcwpBGi2XRb1EWpump',
            asset_symbol: 'MMC',
            asset_name: 'Meme Mining Company',
            entry_price: 3.0999999999999517e-8,
            in_amount: 14193548387097,
            stop_loss: null,
            trailing_sl_percent: 25,
            take_profit: 3.409999999999947e-8,
            trailing_take_profit_percent: null,
            trailing_take_profit_stop_percent: null,
            tx_signature: '_test_1741177688106',
            status: 'open',
            closed_at: null,
            close_reason: null,
            exit_tx_signature: null,
            exit_price: null,
            realized_profit: null,
            exit_amount: null,
        };
        expect(botEventBus.tradeExecuted as jest.Mock).toHaveBeenCalledWith(expectedBuyTradeTransaction);
        expect(insertPosition).toHaveBeenCalledTimes(1);
        expect(insertPosition).toHaveBeenCalledWith(expectedInsertPosition);

        expect((measureExecutionTime as jest.Mock).mock.calls[1][1]).toEqual(
            'pumpfun.sell_simulation_0.001_jito_0.00015',
        );
        expect(pumpfun.sell).toHaveBeenCalledTimes(1);
        expect(pumpfun.sell).toHaveBeenCalledWith({
            transactionMode: 0,
            payerPrivateKey: wallet.privateKey,
            tokenMint: initialCoinData.mint,
            tokenBondingCurve: initialCoinData.bondingCurve,
            tokenAssociatedBondingCurve: initialCoinData.associatedBondingCurve,
            tokenBalance: 14193548387097,
            priorityFeeInSol: 0.001,
            slippageDecimal: 0.25,
            jitoConfig: {
                jitoEnabled: true,
            },
        });

        expect(botEventBus.tradeExecuted as jest.Mock).toHaveBeenCalledWith(expectedSellTradeTransaction);
        expect(closePosition).toHaveBeenCalledTimes(1);
        expect(closePosition).toHaveBeenCalledWith(expectedInsertPosition.trade_id, {
            saleTxSignature: mockReturnedPumpfunSellResponse.signature,
            closeReason: 'TAKE_PROFIT',
            exitPrice: 3.41e-8,
            realizedProfit: expectedBotTradeResponse.netPnl.inSol,
            exitAmount: 11496621999445,
        });

        expect(botEventBus.tradeExecuted as jest.Mock).toHaveBeenCalledTimes(2);
        expect(botEventBus.botTradeResponse as jest.Mock).toHaveBeenCalledTimes(1);
        expect(botEventBus.botTradeResponse as jest.Mock).toHaveBeenCalledWith(expectedBotTradeResponse);

        expect(logs).toEqual(expected.logs);
    });

    it('should exit after wait time when the strategy.shouldExit = true and have no active buy position', async () => {
        const mockReturnedMarketContexts: MarketContext[] = Array(310)
            .fill(0)
            .map((_, i) =>
                formMarketContext({
                    price: (3.42 + i / 100) * 1e-8,
                }),
            );
        mockReturnedMarketContexts.forEach(mr => (marketContextProvider.get as jest.Mock).mockResolvedValueOnce(mr));

        const strategy = new RiseStrategy(logger, {
            maxWaitMs: 10 * 1e3,
            buy: {
                price: {
                    min: 10,
                },
            },
            sell: {
                takeProfitPercentage: 10,
                trailingStopLossPercentage: 25,
            },
        });

        const actual = await pumpfunBot.run('a', initialCoinData, strategy);
        expect(actual).toEqual(readLocalFixture<BotTradeResponse>('pumpfun-bot/exit-no-pump-response'));
    });

    function mockStrategyShouldExitMarketContexts(): void {
        const firstMarketContext = {
            // it will buy here
            price: 4.1e-7,
            marketCap: 60,
            holdersCount: 70,
            bondingCurveProgress: 50,
            devHoldingPercentage: 5,
            topTenHoldingPercentage: 10,
            devHoldingPercentageCirculating: 20,
            topTenHoldingPercentageCirculating: 70,
        };
        const mockReturnedMarketContexts: MarketContext[] = [
            firstMarketContext,
            formMarketContext(
                {
                    // it will do nothing here
                    price: 4.2e-7,
                },
                firstMarketContext,
            ),
            formMarketContext(
                {
                    // it will exit as dumped by the strategy and require sell here
                    price: 3.14e-8,
                    marketCap: 33.4,
                    holdersCount: 1,
                    bondingCurveProgress: 2,
                },
                firstMarketContext,
            ),
            // fill at least maxWaitMonitorAfterResultSeconds + 1 values just so it does nothing but checks for the maxWaitMonitorAfterResultMs
            ...Array(4)
                .fill(0)
                .map((_, i) =>
                    formMarketContext(
                        {
                            price: (3.141 + i / 1000) * 1e-8,
                        },
                        firstMarketContext,
                    ),
                ),
        ];
        mockReturnedMarketContexts.forEach(mr => (marketContextProvider.get as jest.Mock).mockResolvedValueOnce(mr));
    }

    it('should exit and sell when the strategy.shouldExit requires so and we have active buy position and strategy shouldSell is false', async () => {
        mockStrategyShouldExitMarketContexts();

        const strategy = new RiseStrategy(logger, {
            maxWaitMs: 10 * 1e3,
            buy: {
                marketCap: {
                    min: 10,
                },
            },
            sell: {
                takeProfitPercentage: 10,
                trailingStopLossPercentage: 50000,
            },
        });

        (pumpfun.buy as jest.Mock).mockResolvedValue(calculatePumpfunBuyResponse(dummyPumpfunBuyResponse, 4.1e-7));
        (insertPosition as jest.Mock).mockResolvedValue(undefined);
        (pumpfun.sell as jest.Mock).mockResolvedValue(dummyPumpfunSellResponse);
        (closePosition as jest.Mock).mockResolvedValue(undefined);

        const actual = await pumpfunBot.run('a', initialCoinData, strategy);
        expect(actual).toEqual(readLocalFixture<BotTradeResponse>('pumpfun-bot/trade-sell-strategy-exit-response'));
    });

    it('should sell with reason of shouldSell when strategy.shouldSell and strategy.shouldExit both require selling', async () => {
        mockStrategyShouldExitMarketContexts();

        const strategy = new RiseStrategy(logger, {
            maxWaitMs: 10 * 1e3,
            buy: {
                marketCap: {
                    min: 10,
                },
            },
            sell: {
                takeProfitPercentage: 10,
                trailingStopLossPercentage: 25,
            },
        });

        (pumpfun.buy as jest.Mock).mockResolvedValue(calculatePumpfunBuyResponse(dummyPumpfunBuyResponse, 4.1e-7));
        (insertPosition as jest.Mock).mockResolvedValue(undefined);
        (pumpfun.sell as jest.Mock).mockResolvedValue(dummyPumpfunSellResponse);
        (closePosition as jest.Mock).mockResolvedValue(undefined);

        const actual = await pumpfunBot.run('a', initialCoinData, strategy);
        const t = readLocalFixture<BotTradeResponse>('pumpfun-bot/trade-sell-strategy-exit-response');
        t.transactions[1].metadata = {
            ...t.transactions[1].metadata!,
            reason: 'TRAILING_STOP_LOSS',
        };
        expect(actual).toEqual(t);
    });

    it('should not exit when the strategy.shouldExit wants only to exit and not sell, and we have an active buy position. Waits until sell', async () => {
        const mockReturnedMarketContexts: MarketContext[] = [
            // buys here
            formMarketContext({
                price: 3.2e-7,
            }),
            // does nothing here
            formMarketContext({
                price: 3.21e-7,
            }),
            ...Array(5)
                .fill(0)
                .map((_, i) =>
                    formMarketContext({
                        price: (3.22 + i / 1000) * 1e-8,
                    }),
                ),
            formMarketContext({
                // will sell here after maxWait is elapsed
                price: 3.52e-7,
            }),
        ];
        mockReturnedMarketContexts.forEach(mr => (marketContextProvider.get as jest.Mock).mockResolvedValueOnce(mr));

        const strategy = new RiseStrategy(logger, {
            maxWaitMs: 3 * 1e3,
            buy: {
                marketCap: {
                    min: 1,
                },
            },
            sell: {
                takeProfitPercentage: 10,
                trailingStopLossPercentage: 25,
            },
        });

        (pumpfun.buy as jest.Mock).mockResolvedValue(calculatePumpfunBuyResponse(dummyPumpfunBuyResponse, 3.2e-7));
        (insertPosition as jest.Mock).mockResolvedValue(undefined);
        (pumpfun.sell as jest.Mock).mockResolvedValue(dummyPumpfunSellResponse);
        (closePosition as jest.Mock).mockResolvedValue(undefined);

        const actual = await pumpfunBot.run('a', initialCoinData, strategy);
        expect(actual).toEqual(readLocalFixture<BotTradeResponse>('pumpfun-bot/trade-response-2'));
    });

    it('should stop when stopBot is called', cb => {
        defaultMockReturnedMarketContexts();

        const strategy = new RiseStrategy(logger, {
            buy: {
                bondingCurveProgress: {
                    min: 100,
                },
            },
        });

        pumpfunBot.run('a', initialCoinData, strategy).then(value => {
            expect(value).toEqual(readLocalFixture('pumpfun-bot/stop-without-trade-response'));
            cb();
        });
        pumpfunBot.stopBot();
    });

    it('should try to sell the token if we get tx error while buying and throw a fatal error', async () => {
        const mockReturnedMarketContexts: MarketContext[] = [
            // buys here
            formMarketContext({
                price: 3.2e-7,
            }),
            ...Array(4)
                .fill(0)
                .map((_, i) =>
                    formMarketContext({
                        price: (3.22 + i / 1000) * 1e-8,
                    }),
                ),
        ];
        mockReturnedMarketContexts.forEach(mr => (marketContextProvider.get as jest.Mock).mockResolvedValueOnce(mr));

        const strategy = new RiseStrategy(logger, {
            buy: {
                marketCap: {
                    min: 1,
                },
            },
        });

        (pumpfun.buy as jest.Mock).mockResolvedValue({
            ...dummyPumpfunBuyResponse,
            txDetails: {
                ...dummyPumpfunBuyResponse.txDetails,
                error: {
                    type: 'no_idea',
                    object: {},
                },
            },
        } as unknown as PumpfunBuyResponse);
        (sellPumpfunTokensWithRetries as jest.Mock).mockResolvedValue(undefined);

        await expect(pumpfunBot.run('a', initialCoinData, strategy)).rejects.toEqual(new Error('unknown_buying_error'));
        expect(marketContextProvider.get as jest.Mock).toHaveBeenCalledTimes(3);
        expect(pumpfun.sell as jest.Mock).not.toHaveBeenCalled();
        expect(sellPumpfunTokensWithRetries as jest.Mock).toHaveBeenCalledTimes(2);
    });

    it('should throw fatal error when it happens during buy or sell', async () => {
        const mockReturnedMarketContexts: MarketContext[] = [
            // buys here
            formMarketContext({
                price: 3.2e-7,
            }),
            ...Array(4)
                .fill(0)
                .map((_, i) =>
                    formMarketContext({
                        price: (3.22 + i / 1000) * 1e-8,
                    }),
                ),
        ];
        mockReturnedMarketContexts.forEach(mr => (marketContextProvider.get as jest.Mock).mockResolvedValueOnce(mr));

        const strategy = new RiseStrategy(logger, {
            buy: {
                marketCap: {
                    min: 1,
                },
            },
        });

        const error: SolTransactionDetails = {
            grossTransferredLamports: 1,
            netTransferredLamports: 1,
            baseFeeLamports: BASE_FEE_LAMPORTS,
            priorityFeeLamports: 0.005,
            totalFeeLamports: 0.105,
            error: {
                type: 'insufficient_lamports',
                object: {},
            },
        };
        (pumpfun.buy as jest.Mock).mockRejectedValue(error);

        await expect(pumpfunBot.run('a', initialCoinData, strategy)).rejects.toEqual(new Error('no_funds_to_buy'));
    });

    const mockMarketContextThatBuysSellFailsResellOnNext: MarketContext[] = [
        // buys here
        formMarketContext({
            price: 3.2e-8,
        }),
        // won't try to sell here as buy is still in progress
        formMarketContext({
            price: 4.2e-8,
        }),
        // tries to sell and fails on first try due to our mock reject
        formMarketContext({
            price: 4.21e-8,
        }),
        // does nothing as previous sell is in progress
        formMarketContext({
            price: 4.22e-8,
        }),
        formMarketContext({
            price: 4.23e-8,
        }),
        formMarketContext({
            price: 4.24e-8,
        }),
        // retries again as sell conditions are met and succeeds here
        formMarketContext({
            price: 4.25e-8,
        }),
        ...Array(4)
            .fill(0)
            .map((_, i) =>
                formMarketContext({
                    price: (3.141 + i / 1000) * 1e-8,
                }),
            ),
    ];

    test.each([
        [
            'unknown',
            mockMarketContextThatBuysSellFailsResellOnNext,
            new Error('sell_error'),
            {
                path: 'pumpfun-bot/sell-error-that-is-ignored-and-continues-on-next-tick',
                case: 'unknownError',
            },
        ],
        [
            'recreating_existing_associated_token_account',
            mockMarketContextThatBuysSellFailsResellOnNext,
            {
                ...dummyPumpfunSellResponse,
                txDetails: TxWithIllegalOwnerError,
            } satisfies PumpfunSellResponse,
            {
                path: 'pumpfun-bot/sell-error-that-is-ignored-and-continues-on-next-tick',
                case: 'recreatingExistingAssociatedTokenAccountError',
            },
        ],
    ] satisfies [string, MarketContext[], Error | PumpfunSellResponse, MultiCaseFixture][])(
        'should handle sell error of type %s properly, log error and try to sell on next try if conditions still meet',
        async (_, mockReturnedMarketContexts, pumpfunSellResponseOrError, localFixtureInfo) => {
            mockReturnedMarketContexts.forEach(mr =>
                (marketContextProvider.get as jest.Mock).mockResolvedValueOnce(mr),
            );

            const strategy = new RiseStrategy(logger, {
                buy: {
                    marketCap: {
                        min: 1,
                    },
                },
                sell: {
                    takeProfitPercentage: 10,
                },
            });

            (pumpfun.buy as jest.Mock).mockResolvedValue(
                calculatePumpfunBuyResponse(dummyPumpfunBuyResponse, mockReturnedMarketContexts[0].price),
            );
            (insertPosition as jest.Mock).mockResolvedValue(undefined);
            if (pumpfunSellResponseOrError instanceof Error) {
                (pumpfun.sell as jest.Mock)
                    .mockRejectedValueOnce(new Error('sell_error'))
                    .mockResolvedValueOnce(dummyPumpfunSellResponse);
            } else {
                (pumpfun.sell as jest.Mock)
                    .mockResolvedValueOnce(pumpfunSellResponseOrError)
                    .mockResolvedValueOnce(dummyPumpfunSellResponse);
            }

            (closePosition as jest.Mock).mockResolvedValue(undefined);

            const expected = readLocalFixture<FullTestMultiCaseExpectation>(localFixtureInfo.path);

            expect(await pumpfunBot.run('a', initialCoinData, strategy)).toEqual(
                expected[localFixtureInfo.case]?.result ?? expected['default'].result,
            );
            expect(logs).toEqual(expected[localFixtureInfo.case]?.logs ?? expected['default'].logs);
            expect(marketContextProvider.get as jest.Mock).toHaveBeenCalledTimes(11);
            expect(pumpfun.buy as jest.Mock).toHaveBeenCalledTimes(1);
            expect(pumpfun.sell as jest.Mock).toHaveBeenCalledTimes(2);
            expect(closePosition).toHaveBeenCalledTimes(1);
        },
    );

    it('should throw error if you try to run while it is already running', async () => {
        defaultMockReturnedMarketContexts();

        const strategy = new RiseStrategy(logger, {
            buy: {
                bondingCurveProgress: {
                    min: 100,
                },
            },
        });

        await expect(async () => {
            await Promise.all([
                pumpfunBot.run('a', initialCoinData, strategy),
                pumpfunBot.run('a', initialCoinData, strategy),
            ]);
        }).rejects.toThrow('Bot is already running!');
    });

    function defaultMockReturnedMarketContexts(): void {
        const mockReturnedMarketContexts: MarketContext[] = Array(100)
            .fill(0)
            .map((_, i) =>
                formMarketContext({
                    price: (3.42 + i / 100) * 1e-8,
                    marketCap: 33 + i,
                }),
            );
        mockReturnedMarketContexts.forEach(mr => (marketContextProvider.get as jest.Mock).mockResolvedValueOnce(mr));
    }
});

/**
 * A test util function to calculate the transaction gross transferred lamports
 * which do match the provided amount and desired price in sol
 */
function calculateGrossTransferredLamports(amountRaw: number, desiredPriceInSol: number): number {
    return (amountRaw * solToLamports(desiredPriceInSol)) / 10 ** PUMPFUN_TOKEN_DECIMALS;
}

function calculatePumpfunBuyResponse(r: PumpfunBuyResponse, desiredPriceInSol: number): PumpfunBuyResponse {
    return {
        ...r,
        txDetails: {
            ...r.txDetails,
            grossTransferredLamports: calculateGrossTransferredLamports(r.boughtAmountRaw, desiredPriceInSol),
        },
    };
}
