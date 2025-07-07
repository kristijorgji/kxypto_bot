import { ParsedTransactionWithMeta } from '@solana/web3.js';
import WS from 'jest-websocket-mock';

import * as pumpBase from '../../../../../../src/blockchains/solana/dex/pumpfun/pump-base';
import { BondingCurveState } from '../../../../../../src/blockchains/solana/dex/pumpfun/pump-base';
import * as pumpSimulation from '../../../../../../src/blockchains/solana/dex/pumpfun/pump-simulation';
import Pumpfun from '../../../../../../src/blockchains/solana/dex/pumpfun/Pumpfun';
import { PumpfunBuyResponse, PumpfunSellResponse } from '../../../../../../src/blockchains/solana/dex/pumpfun/types';
import { TIP_LAMPORTS } from '../../../../../../src/blockchains/solana/Jito';
import {
    SolFullTransactionDetails,
    TransactionMode,
    TransactionResult,
    WalletInfo,
} from '../../../../../../src/blockchains/solana/types';
import { sendTx } from '../../../../../../src/blockchains/solana/utils/helpers';
import {
    getSolTransactionDetails,
    parseSolTransactionDetails,
} from '../../../../../../src/blockchains/solana/utils/transactions';
import { PumpfunPositionMeta } from '../../../../../../src/trading/bots/blockchains/solana/types';
import { sleep } from '../../../../../../src/utils/functions';
import { FirstArg } from '../../../../../../src/utils/types';
import CustomMockWebSocket from '../../../../../__mocks__/ws';
import { objToParsedTransactionWithMeta } from '../../../../../__utils/blockchains/solana';
import { rawFixture, readLocalFixture } from '../../../../../__utils/data';

jest.mock('@solana/web3.js', () => {
    const actualWeb3 = jest.requireActual('@solana/web3.js');

    return {
        ...actualWeb3,
        Connection: jest.fn().mockImplementation(() => ({
            getAccountInfo: jest.fn(),
            getParsedTransaction: jest.fn(),
        })),
    };
});

jest.mock('../../../../../../src/utils/functions', () => ({
    ...jest.requireActual('../../../../../../src/utils/functions'),
    sleep: jest.fn(),
}));

jest.mock('../../../../../../src/blockchains/solana/dex/pumpfun/pump-base', () => ({
    ...jest.requireActual('../../../../../../src/blockchains/solana/dex/pumpfun/pump-base'),
    getTokenBondingCurveState: jest.fn(),
}));

jest.mock('../../../../../../src/blockchains/solana/utils/helpers', () => ({
    ...jest.requireActual('../../../../../../src/blockchains/solana/utils/helpers'),
    sendTx: jest.fn(),
}));

jest.mock('../../../../../../src/blockchains/solana/utils/transactions', () => ({
    ...jest.requireActual('../../../../../../src/blockchains/solana/utils/transactions'),
    getSolTransactionDetails: jest.fn(),
}));

jest.mock('../../../../../../src/blockchains/solana/utils/simulations', () => ({
    ...jest.requireActual('../../../../../../src/blockchains/solana/utils/simulations'),
    simulatePriceWithHigherSlippage: jest
        .fn()
        .mockImplementation((solInLamports: number, slippageDecimal: number) => solInLamports * (1 + slippageDecimal)),
    simulatePriceWithLowerSlippage: jest
        .fn()
        .mockImplementation((solInLamports: number, slippageDecimal: number) => solInLamports * (1 - slippageDecimal)),
}));

describe(Pumpfun.name, () => {
    let pumpfun: Pumpfun;
    let server: WS;

    let simulatePumpBuyLatencyMsSpy: jest.SpyInstance;
    let simulatePumpSellLatencyMsSpy: jest.SpyInstance;

    const wallet: WalletInfo = {
        privateKey: 'o8ba2p2ZX2eTsDKenr6rGXtepAiz81U3d5SGftgMU8dP8P5nwvKjuLZDHwmNahz2RvnhbZ4DMK7FQUSpaUkG6g1',
        address: 'BLWTHvhQn4nxzsDow5YoX48Qc2vvwefHYHxfHXNpiA5F',
    };
    // the values here should match the ones of the transaction otherwise the actual buy and sell price can't be calculated
    const tokenInfo = {
        mint: 'E5DoNiJ7KsqYgirbPJCD35XUMXzo83aYYzqayMjZpump',
        bondingCurve: '6vmaRCvgHGbLfjk7TxrdsUkxgNiyPenbDSbnkvctGhvq',
        associatedBondingCurve: 'D8EMS9E1HKGVzhrPvFYsww4LfmpaWsgQbH9uXhyyChGN',
        creator: 'DNkrh5SBLrwUKyqhW96t7H3cfNtFGL1bQtKZMiDz5jxV',
    };
    const startActionBondingCurveState: BondingCurveState = {
        dev: tokenInfo.creator,
        bondingCurve: tokenInfo.bondingCurve,
        virtualSolReserves: 58569661730,
        virtualTokenReserves: 1043137958064512,
        realTokenReserves: 766800000000000,
        realSolReserves: 753797654,
        tokenTotalSupply: 1000000000000000,
        complete: false,
    };
    const pumpSimMetadata: PumpfunPositionMeta = {
        startActionBondingCurveState: startActionBondingCurveState,
        price: {
            calculationMode: 'simulation',
        },
    };

    beforeEach(async () => {
        server = new WS(process.env.SOLANA_WSS_ENDPOINT as string);
        pumpfun = new Pumpfun({
            rpcEndpoint: process.env.SOLANA_RPC_ENDPOINT as string,
            wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
        });

        (pumpBase.getTokenBondingCurveState as jest.Mock).mockResolvedValue(startActionBondingCurveState);

        simulatePumpBuyLatencyMsSpy = jest.spyOn(pumpSimulation, 'simulatePumpBuyLatencyMs').mockImplementation(() => {
            return 1;
        });
        simulatePumpSellLatencyMsSpy = jest
            .spyOn(pumpSimulation, 'simulatePumpSellLatencyMs')
            .mockImplementation(() => {
                return 1;
            });
    });

    afterEach(() => {
        WS.clean();
        jest.clearAllMocks();
        pumpfun && pumpfun.stopListeningToNewTokens();
    });

    it('should monitor new tokens and notify with correctly parsed token data', async () => {
        const onNewTokenFn = jest.fn();

        await pumpfun.listenForPumpFunTokens(onNewTokenFn);
        await server.connected;

        server.send(rawFixture('dex/pumpfun/wss-on-message-logsSubscribe-logsNotification-create-0.json'));
        server.send(rawFixture('dex/pumpfun/wss-on-message-logsSubscribe-logsNotification-create-1.json'));

        expect(CustomMockWebSocket.sendMockFn).toHaveBeenCalledTimes(1);
        expect(CustomMockWebSocket.sendMockFn.mock.calls[0]).toEqual([
            '{"jsonrpc":"2.0","id":1,"method":"logsSubscribe","params":[{"mentions":["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"]},{"commitment":"processed"}]}',
        ]);

        expect(onNewTokenFn).toHaveBeenCalledTimes(2);
        expect(onNewTokenFn.mock.calls[0]).toEqual([
            {
                bondingCurve: '62pDpy9wCn4dyk2Y32mkGSPVzYUsNE6Dyb2GvAq5RXdk',
                mint: '9pSA9tgqgV8AUq7EFEXjHCrr7q6zmf9pxHkpbMDypump',
                name: 'Grammarlzy AI',
                symbol: 'Grammarly',
                uri: 'https://ipfs.io/ipfs/QmPULbJjjzEesD7Tc56H5j5sYGHG6d5uRzKjsZqHS9ud81',
                user: '931KZ79266ZsQVfbfvseWwQvCGLSVEDbyhXTKaQdGh9X',
            },
        ]);
        expect(onNewTokenFn.mock.calls[1]).toEqual([
            {
                name: 'Customer Dog',
                symbol: 'CDOG',
                uri: 'https://ipfs.io/ipfs/QmQ8YtukoR1K1WR5N3x5bNARkHdZ2EYbqcYkQ9aXogKeRr',
                mint: '2iZNDJ5Rwct7nThrtSAkJeEut5LxMrjZd6MRf3dWpump',
                bondingCurve: 'AHFj2ZfBd5Z1cRTk3oYXAgXFyDZ9kGHVCpHEBdvyEGKV',
                user: '6hPPEBvDgpWiwPRzB3jN7C7YVnHxZG1d3XE4reVaXA3k',
            },
        ]);
    });

    describe('buy', () => {
        beforeAll(() => {
            jest.useFakeTimers();
            jest.setSystemTime(new Date('2025-02-01T16:04:00.000Z'));
        });

        afterAll(() => {
            jest.useRealTimers();
        });

        const buyArgs: FirstArg<typeof pumpfun.buy> = {
            transactionMode: TransactionMode.Execution,
            wallet: wallet,
            tokenMint: tokenInfo.mint,
            tokenBondingCurve: tokenInfo.bondingCurve,
            tokenAssociatedBondingCurve: tokenInfo.associatedBondingCurve,
            solIn: 0.2,
            priorityFeeInSol: 0.005,
            slippageDecimal: 0.25,
            jitoConfig: {
                jitoEnabled: true,
                tipLamports: TIP_LAMPORTS,
            },
        };

        it('in execution mode using jito and return correct actualPrice and values', async () => {
            (pumpfun.connection.getAccountInfo as jest.Mock).mockResolvedValue({});
            (sendTx as jest.Mock).mockResolvedValue({
                success: true,
                signature: 'test_signature',
            } satisfies TransactionResult);
            const buyTx = objToParsedTransactionWithMeta(
                readLocalFixture<ParsedTransactionWithMeta>('pump-buy-tx-with-jito-acc-fee'),
            );
            (getSolTransactionDetails as jest.Mock).mockResolvedValue({
                ...parseSolTransactionDetails(buyTx, wallet.address),
                fullTransaction: buyTx,
            } satisfies SolFullTransactionDetails);

            const actual = await pumpfun.buy(buyArgs);

            expect(actual).toEqual({
                actualBuyPriceSol: 5.6578677140739156e-8,
                boughtAmountRaw: 3562041942032,
                pumpMaxSolCost: 250000000,
                pumpTokenOut: 3562041942032,
                signature: 'test_signature',
                txDetails: {
                    baseFeeLamports: 5000,
                    grossTransferredLamports: -205740258,
                    netTransferredLamports: -212745258,
                    priorityFeeLamports: 7000000,
                    totalFeeLamports: 7005000,
                },
                metadata: {
                    startActionBondingCurveState: startActionBondingCurveState,
                    price: {
                        calculationMode: 'bondingCurveTransferred',
                        fromBondingCurveTransferredInSol: 5.6578677140739156e-8,
                        fromTxGrossTransferredInSol: 5.775907789638028e-8,
                    },
                },
            } satisfies PumpfunBuyResponse);
        });

        it('in simulation mode using jito and return correct actualPrice and values', async () => {
            (pumpfun.connection.getAccountInfo as jest.Mock).mockResolvedValue({});
            simulatePumpBuyLatencyMsSpy.mockImplementation(() => {
                return 17783;
            });

            const actual = await pumpfun.buy({
                ...buyArgs,
                transactionMode: TransactionMode.Simulation,
            } satisfies FirstArg<typeof pumpfun.buy>);

            expect(actual).toEqual({
                actualBuyPriceSol: 0.25,
                boughtAmountRaw: 3562041942032,
                pumpMaxSolCost: 250000000,
                pumpTokenOut: 3562041942032,
                signature: '_simulation_1738425840000',
                txDetails: {
                    baseFeeLamports: 5000,
                    grossTransferredLamports: -250150000,
                    netTransferredLamports: -255155000,
                    priorityFeeLamports: 5000000,
                    totalFeeLamports: 5005000,
                },
                metadata: pumpSimMetadata,
            } satisfies PumpfunBuyResponse);

            expect(sleep as jest.Mock).toHaveBeenCalledWith(17783);
        });
    });

    describe('sell', () => {
        beforeAll(() => {
            jest.useFakeTimers();
            jest.setSystemTime(new Date('2025-02-01T16:04:00.000Z'));
        });

        afterAll(() => {
            jest.useRealTimers();
        });

        const sellArgs: FirstArg<typeof pumpfun.sell> = {
            transactionMode: TransactionMode.Execution,
            wallet: wallet,
            tokenMint: tokenInfo.mint,
            tokenBondingCurve: tokenInfo.bondingCurve,
            tokenAssociatedBondingCurve: tokenInfo.associatedBondingCurve,
            tokenBalance: 3562041942032,
            priorityFeeInSol: 0.005,
            slippageDecimal: 0.25,
            jitoConfig: {
                jitoEnabled: true,
                tipLamports: TIP_LAMPORTS,
            },
        };

        it('in execution mode using jito and return correct actualPrice and values', async () => {
            (pumpfun.connection.getAccountInfo as jest.Mock).mockResolvedValue({});
            (sendTx as jest.Mock).mockResolvedValue({
                success: true,
                signature: 'test_signature',
            } satisfies TransactionResult);
            const sellTx = objToParsedTransactionWithMeta(
                readLocalFixture<ParsedTransactionWithMeta>('pump-sell-tx-with-jito'),
            );
            (getSolTransactionDetails as jest.Mock).mockResolvedValue({
                ...parseSolTransactionDetails(sellTx, wallet.address),
                fullTransaction: sellTx,
            } satisfies SolFullTransactionDetails);

            const actual = await pumpfun.sell(sellArgs);

            expect(actual).toEqual({
                actualSellPriceSol: 2.8515233299599232e-8,
                minLamportsOutput: 149999999,
                signature: 'test_signature',
                soldRawAmount: 3562041942032,
                txDetails: {
                    baseFeeLamports: 5000,
                    grossTransferredLamports: 100406731,
                    netTransferredLamports: 93401731,
                    priorityFeeLamports: 7000000,
                    totalFeeLamports: 7005000,
                },
                metadata: {
                    startActionBondingCurveState: startActionBondingCurveState,
                    price: {
                        calculationMode: 'bondingCurveTransferred',
                        fromBondingCurveTransferredInSol: 2.8515233299599232e-8,
                        fromTxGrossTransferredInSol: 2.818796988749718e-8,
                    },
                },
            } satisfies PumpfunSellResponse);
        });

        it('in simulation mode using jito and return correct actualPrice and values', async () => {
            (pumpfun.connection.getAccountInfo as jest.Mock).mockResolvedValue({});
            simulatePumpSellLatencyMsSpy.mockImplementation(() => {
                return 7123;
            });

            const actual = await pumpfun.sell({
                ...sellArgs,
                transactionMode: TransactionMode.Simulation,
            } satisfies FirstArg<typeof pumpfun.sell>);

            expect(actual).toEqual({
                actualSellPriceSol: 0.1499999999999886,
                minLamportsOutput: 149999999,
                signature: '_simulation_1738425840000',
                soldRawAmount: 3562041942032,
                txDetails: {
                    baseFeeLamports: 5000,
                    grossTransferredLamports: 149849999.9999886,
                    netTransferredLamports: 144844999.9999886,
                    priorityFeeLamports: 5000000,
                    totalFeeLamports: 5005000,
                },
                metadata: pumpSimMetadata,
            } satisfies PumpfunSellResponse);

            expect(sleep as jest.Mock).toHaveBeenCalledWith(7123);
        });
    });
});
