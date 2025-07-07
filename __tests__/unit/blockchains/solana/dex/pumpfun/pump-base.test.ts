import {
    calculatePriceInLamports,
    calculatePumpTokenLamportsValue,
    extractPossibleErrorFromTx,
} from '../../../../../../src/blockchains/solana/dex/pumpfun/pump-base';
import { SolPumpfunTransactionDetails } from '../../../../../../src/blockchains/solana/dex/pumpfun/types';
import { parseSolTransactionDetails } from '../../../../../../src/blockchains/solana/utils/transactions';
import { fixtureToParsedTransactionWithMeta } from '../../../../../__utils/blockchains/solana';

describe('calculatePumpTokenLamportsValue', () => {
    it('should calculate the lamports amount of X number of raw token amounts correctly', () => {
        expect(calculatePumpTokenLamportsValue(123477, 3.22344e-8)).toBeCloseTo(3.9802070087999994, 8);
    });
});

describe('calculatePriceInLamports', () => {
    it('should calculate the price in lamports for a single raw token amount correctly', () => {
        expect(
            calculatePriceInLamports({
                amountRaw: 23523311218007,
                lamports: 1061568978,
            }),
        ).toBeCloseTo(45.12838214661604, 8);
    });
});

describe('extractPossibleErrorFromTx', () => {
    it('should handle pumpfun insufficient funds error', async () => {
        const fullTx = fixtureToParsedTransactionWithMeta(
            'blockchains/solana/get-parsed-transaction-pump-jito-insufficient-lamports-response',
        );

        expect(
            extractPossibleErrorFromTx({
                ...parseSolTransactionDetails(fullTx, 'CPp14jCnVJMt5nPA3A37S58gjxQEnc8Bn5U1J72LiWD1'),
                fullTransaction: fullTx,
            }),
        ).toEqual({
            grossTransferredLamports: 0,
            netTransferredLamports: -7005000,
            baseFeeLamports: 5000,
            priorityFeeLamports: 7000000,
            totalFeeLamports: 7005000,
            error: {
                type: 'insufficient_lamports',
                object: {
                    InstructionError: [
                        4,
                        {
                            Custom: 1,
                        },
                    ],
                },
            },
        } satisfies SolPumpfunTransactionDetails);
    });

    it('should handle pumpfun slippage more sol required error', async () => {
        const fullTx = fixtureToParsedTransactionWithMeta(
            'blockchains/solana/get-parsed-transaction-pump-slippage-insufficient-sol-response',
        );

        expect(
            extractPossibleErrorFromTx({
                ...parseSolTransactionDetails(fullTx, 'CPp14jCnVJMt5nPA3A37S58gjxQEnc8Bn5U1J72LiWD1'),
                fullTransaction: fullTx,
            }),
        ).toEqual({
            grossTransferredLamports: 0,
            netTransferredLamports: -7005000,
            baseFeeLamports: 5000,
            priorityFeeLamports: 7000000,
            totalFeeLamports: 7005000,
            error: {
                type: 'pumpfun_slippage_more_sol_required',
                object: {
                    InstructionError: [
                        4,
                        {
                            Custom: 6002,
                        },
                    ],
                },
            },
        } satisfies SolPumpfunTransactionDetails);
    });

    /**
     * This error happens very rarely when we try to sell almost immediately after buying and the sell function
     * doesn't fetch the existing associated token account and tries to create it again
     * A retry will solve the issue
     */
    it('should handle pumpfun sell error due to trying to create associated token account again', async () => {
        expect(
            extractPossibleErrorFromTx({
                ...parseSolTransactionDetails(
                    TxWithIllegalOwnerError.fullTransaction,
                    'CPp14jCnVJMt5nPA3A37S58gjxQEnc8Bn5U1J72LiWD1',
                ),
                fullTransaction: TxWithIllegalOwnerError.fullTransaction,
            }),
        ).toEqual(TxWithIllegalOwnerError.parsedTx);
    });
});

export const TxWithIllegalOwnerError = {
    parsedTx: {
        grossTransferredLamports: 0,
        netTransferredLamports: -7005000,
        baseFeeLamports: 5000,
        priorityFeeLamports: 7000000,
        totalFeeLamports: 7005000,
        error: {
            type: 'unknown',
            object: {
                InstructionError: [3, 'IllegalOwner'],
            },
        },
    } satisfies SolPumpfunTransactionDetails,
    fullTransaction: fixtureToParsedTransactionWithMeta(
        'blockchains/solana/get-parsed-transaction-provider-owner-not-allowed-response',
    ),
};
