import { SolPumpfunTransactionDetails } from '../../../../../../../src/blockchains/solana/dex/pumpfun/types';
import { extractPossibleErrorFromTx } from '../../../../../../../src/blockchains/solana/dex/pumpfun/utils/tx-parser';
import { parseSolTransactionDetails } from '../../../../../../../src/blockchains/solana/utils/transactions';
import { fixtureToParsedTransactionWithMeta } from '../../../../../../__utils/blockchains/solana';
import { TxWithIllegalOwnerError, TxWithNotEnoughTokensToSellError } from '../data';

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

    it('should handle pumpfun sell error when we do not have enough tokens to sell', async () => {
        expect(
            extractPossibleErrorFromTx({
                ...parseSolTransactionDetails(
                    TxWithNotEnoughTokensToSellError.fullTransaction,
                    'CPp14jCnVJMt5nPA3A37S58gjxQEnc8Bn5U1J72LiWD1',
                ),
                fullTransaction: TxWithNotEnoughTokensToSellError.fullTransaction,
            }),
        ).toEqual(TxWithNotEnoughTokensToSellError.parsedTx);
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
