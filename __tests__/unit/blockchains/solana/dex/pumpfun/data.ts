import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { ParsedTransactionWithMeta } from '@solana/web3.js';

import {
    BondingCurveState,
    SolPumpfunTransactionDetails,
} from '../../../../../../src/blockchains/solana/dex/pumpfun/types';
import {
    fixtureToParsedTransactionWithMeta,
    objToParsedTransactionWithMeta,
} from '../../../../../__utils/blockchains/solana';
import { readLocalFixture } from '../../../../../__utils/data';

// the values here should match the ones of the transaction otherwise the actual buy and sell price can't be calculated
export const tokenInfo = {
    mint: 'E5DoNiJ7KsqYgirbPJCD35XUMXzo83aYYzqayMjZpump',
    tokenProgramId: TOKEN_PROGRAM_ID.toBase58(),
    bondingCurve: '6vmaRCvgHGbLfjk7TxrdsUkxgNiyPenbDSbnkvctGhvq',
    associatedBondingCurve: 'D8EMS9E1HKGVzhrPvFYsww4LfmpaWsgQbH9uXhyyChGN',
    creator: 'DNkrh5SBLrwUKyqhW96t7H3cfNtFGL1bQtKZMiDz5jxV',
};

export const startActionBondingCurveState: BondingCurveState = {
    dev: tokenInfo.creator,
    bondingCurve: tokenInfo.bondingCurve,
    virtualSolReserves: 58569661730,
    virtualTokenReserves: 1043137958064512,
    realTokenReserves: 766800000000000,
    realSolReserves: 753797654,
    tokenTotalSupply: 1000000000000000,
    complete: false,
};

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
