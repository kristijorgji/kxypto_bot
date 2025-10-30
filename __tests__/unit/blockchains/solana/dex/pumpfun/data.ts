import { ParsedTransactionWithMeta } from '@solana/web3.js';

import { SolPumpfunTransactionDetails } from '../../../../../../src/blockchains/solana/dex/pumpfun/types';
import {
    fixtureToParsedTransactionWithMeta,
    objToParsedTransactionWithMeta,
} from '../../../../../__utils/blockchains/solana';
import { readLocalFixture } from '../../../../../__utils/data';

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

export const TxWithNotEnoughTokensToSellError = {
    parsedTx: {
        grossTransferredLamports: 0,
        netTransferredLamports: -7005000,
        baseFeeLamports: 5000,
        priorityFeeLamports: 7000000,
        totalFeeLamports: 7005000,
        error: {
            type: 'pump_sell_not_enough_tokens',
            object: {
                InstructionError: [
                    3,
                    {
                        Custom: 6023,
                    },
                ],
            },
        },
    } satisfies SolPumpfunTransactionDetails,
    fullTransaction: objToParsedTransactionWithMeta(
        readLocalFixture<ParsedTransactionWithMeta>('pump-sell-tx-not-enough-tokens-to-sell'),
    ),
};
