import { Connection } from '@solana/web3.js';

import { getSolTransactionDetails } from '../../../../../src/blockchains/solana/utils/transactions';
import { fixtureToParsedTransactionWithMeta } from '../../../../__utils/blockchains/solana';

jest.mock('../../../../../src/apm/apm');

jest.mock('@solana/web3.js', () => {
    const actualWeb3 = jest.requireActual('@solana/web3.js');

    return {
        ...actualWeb3,
        Connection: jest.fn().mockImplementation(() => ({
            getParsedTransaction: jest.fn(),
        })),
    };
});

describe(getSolTransactionDetails.name, () => {
    let connection: Connection;

    beforeEach(() => {
        connection = new Connection(process.env.SOLANA_RPC_ENDPOINT as string);
    });

    it('should handle pumpfun buy transaction', async () => {
        (connection.getParsedTransaction as jest.Mock).mockResolvedValueOnce(
            fixtureToParsedTransactionWithMeta('blockchains/solana/get-parsed-transaction-pump-jito-buy-response'),
        );

        expect(
            await getSolTransactionDetails(
                connection,
                '2rTZLYEUGh9PMaJd785LUkLKx8vQezZ1gvxdyAjJ4rXZnEMEJ8bAupD81TZWDsbkFLdo9XCGxAnqwAXqih1XTEk8',
                'CPp14jCnVJMt5nPA3A37S58gjxQEnc8Bn5U1J72LiWD1',
                {
                    sleepMs: 10,
                    maxRetries: 5,
                },
            ),
        ).toEqual({
            grossTransferredLamports: -413079487,
            netTransferredLamports: -420084487,
            baseFeeLamports: 5000,
            priorityFeeLamports: 7000000,
            totalFeeLamports: 7005000,
        });
    });

    it('should handle pumpfun sell transaction', async () => {
        (connection.getParsedTransaction as jest.Mock).mockResolvedValueOnce(
            fixtureToParsedTransactionWithMeta('blockchains/solana/get-parsed-transaction-pump-jito-sell-response'),
        );

        expect(
            await getSolTransactionDetails(
                connection,
                '3EBWPyZHcv6ZCFVY5R49JnuBp9vK1pAaT4ZymBnVJN2ZivfSs8upED9NeP6YV7GFeSRmQNVVEAFTH2mQPhjnwyxr',
                'CPp14jCnVJMt5nPA3A37S58gjxQEnc8Bn5U1J72LiWD1',
                {
                    sleepMs: 10,
                    maxRetries: 5,
                },
            ),
        ).toEqual({
            grossTransferredLamports: 470516583,
            netTransferredLamports: 463511583,
            baseFeeLamports: 5000,
            priorityFeeLamports: 7000000,
            totalFeeLamports: 7005000,
        });
    });

    it('should handle pumpfun insufficient funds error', async () => {
        (connection.getParsedTransaction as jest.Mock).mockResolvedValueOnce(
            fixtureToParsedTransactionWithMeta(
                'blockchains/solana/get-parsed-transaction-pump-jito-insufficient-lamports-response',
            ),
        );

        expect(
            await getSolTransactionDetails(
                connection,
                '2e7ynRmqgYk2p9YHGX9K9DiqY7by4Gs9yAEhN8r3yBvccyMsoE2KdC1rpwSJXdz2Dt3acudVSrKFTAGeQ6fD1zWy',
                'CPp14jCnVJMt5nPA3A37S58gjxQEnc8Bn5U1J72LiWD1',
                {
                    sleepMs: 10,
                    maxRetries: 5,
                },
            ),
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
        });
    });
});
