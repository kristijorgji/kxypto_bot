import {
    BondingCurve,
    OnlinePumpSdk,
    PUMP_SDK,
    getBuyTokenAmountFromSolAmount,
    getSellSolAmountFromTokenAmount,
} from '@pump-fun/pump-sdk';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { AccountInfo, ParsedTransactionWithMeta, TransactionInstruction } from '@solana/web3.js';
import BN from 'bn.js';

import { startActionBondingCurveState, tokenInfo } from './data';
import { toSdkBondingCurve } from '../../../../../../src/blockchains/solana/dex/pumpfun/pump-bonding-curve';
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
import { objToParsedTransactionWithMeta } from '../../../../../__utils/blockchains/solana';
import { readLocalFixture } from '../../../../../__utils/data';

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

const MockOnlinePumpSdkInstance = {
    fetchGlobal: jest.fn(),
    fetchBuyState: jest.fn(),
    fetchFeeConfig: jest.fn(),
    fetchSellState: jest.fn(),
} satisfies Partial<InstanceType<typeof OnlinePumpSdk>>;

jest.mock('@pump-fun/pump-sdk', () => ({
    ...jest.requireActual('@pump-fun/pump-sdk'),
    OnlinePumpSdk: jest.fn().mockImplementation(() => MockOnlinePumpSdkInstance),
    PUMP_SDK: {
        buyInstructions: jest.fn(),
        sellInstructions: jest.fn(),
    } satisfies Partial<typeof PUMP_SDK>,
    getBuyTokenAmountFromSolAmount: jest.fn(),
    getSellSolAmountFromTokenAmount: jest.fn(),
}));

jest.mock('../../../../../../src/utils/functions', () => ({
    ...jest.requireActual('../../../../../../src/utils/functions'),
    sleep: jest.fn(),
}));

jest.mock('../../../../../../src/blockchains/solana/dex/pumpfun/pump-bonding-curve', () => ({
    ...jest.requireActual('../../../../../../src/blockchains/solana/dex/pumpfun/pump-bonding-curve'),
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

    let simulatePumpBuyLatencyMsSpy: jest.SpyInstance;
    let simulatePumpSellLatencyMsSpy: jest.SpyInstance;

    const wallet: WalletInfo = {
        privateKey: 'o8ba2p2ZX2eTsDKenr6rGXtepAiz81U3d5SGftgMU8dP8P5nwvKjuLZDHwmNahz2RvnhbZ4DMK7FQUSpaUkG6g1',
        address: 'BLWTHvhQn4nxzsDow5YoX48Qc2vvwefHYHxfHXNpiA5F',
    };
    const pumpSimMetadata: PumpfunPositionMeta = {
        startActionBondingCurveState: startActionBondingCurveState,
        price: {
            calculationMode: 'simulation',
        },
    };

    beforeEach(async () => {
        pumpfun = new Pumpfun({
            rpcEndpoint: process.env.SOLANA_RPC_ENDPOINT as string,
            wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
        });

        MockOnlinePumpSdkInstance.fetchBuyState.mockResolvedValue({
            bondingCurve: toSdkBondingCurve(startActionBondingCurveState) satisfies BondingCurve,
            bondingCurveAccountInfo: {
                data: [],
            } as unknown as AccountInfo<Buffer>,
            associatedUserAccountInfo: {
                data: [],
            } as unknown as AccountInfo<Buffer>,
        } satisfies Awaited<ReturnType<InstanceType<typeof OnlinePumpSdk>['fetchBuyState']>>);

        MockOnlinePumpSdkInstance.fetchSellState.mockResolvedValue({
            bondingCurve: toSdkBondingCurve(startActionBondingCurveState) satisfies BondingCurve,
            bondingCurveAccountInfo: {
                data: [],
            } as unknown as AccountInfo<Buffer>,
        } satisfies Awaited<ReturnType<InstanceType<typeof OnlinePumpSdk>['fetchSellState']>>);

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
        jest.clearAllMocks();
        pumpfun && pumpfun.stopListeningToNewTokens();
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
            tokenProgramId: tokenInfo.tokenProgramId,
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
            (getBuyTokenAmountFromSolAmount as jest.Mock).mockReturnValue(new BN(3562041942032));
            (PUMP_SDK.buyInstructions as jest.Mock).mockResolvedValue([
                {
                    data: new Buffer(''),
                    programId: TOKEN_PROGRAM_ID,
                    keys: [],
                },
            ] satisfies TransactionInstruction[]);
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
                    grossTransferredLamports: -254195000,
                    netTransferredLamports: -259200000,
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
            tokenProgramId: tokenInfo.tokenProgramId,
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
            (getSellSolAmountFromTokenAmount as jest.Mock).mockReturnValue(new BN(149999999));
            (PUMP_SDK.sellInstructions as jest.Mock).mockResolvedValue([
                {
                    data: new Buffer(''),
                    programId: TOKEN_PROGRAM_ID,
                    keys: [],
                },
            ] satisfies TransactionInstruction[]);
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
            simulatePumpSellLatencyMsSpy.mockImplementation(() => {
                return 7123;
            });

            const actual = await pumpfun.sell({
                ...sellArgs,
                transactionMode: TransactionMode.Simulation,
            } satisfies FirstArg<typeof pumpfun.sell>);

            expect(actual).toEqual({
                actualSellPriceSol: 0.149999999,
                minLamportsOutput: 149999999,
                signature: '_simulation_1738425840000',
                soldRawAmount: 3562041942032,
                txDetails: {
                    baseFeeLamports: 5000,
                    grossTransferredLamports: 149849999,
                    netTransferredLamports: 144844999,
                    priorityFeeLamports: 5000000,
                    totalFeeLamports: 5005000,
                },
                metadata: pumpSimMetadata,
            } satisfies PumpfunSellResponse);

            expect(sleep as jest.Mock).toHaveBeenCalledWith(7123);
        });
    });
});
