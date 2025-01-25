import fs from 'fs';

import { Connection, PublicKey, TokenBalance } from '@solana/web3.js';

import { storeData } from './utils';
import { logger } from '../../../../logger';

const rayFee = new PublicKey('7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5');
const raydiumAuthorityV4Account = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1';
const wrappedSolToken = 'So11111111111111111111111111111111111111112';

export async function monitorNewTokens(
    connection: Connection,
    args: {
        dataPath: string;
        verbose?: boolean;
    },
) {
    const verbose = args?.verbose ?? true;
    if (verbose) {
        logger.info('monitoring new solana tokens...');
    }

    try {
        connection.onLogs(
            rayFee,
            async ({ logs, err, signature }) => {
                try {
                    if (err) {
                        if (verbose) {
                            logger.error(`connection contains error, ${err}`);
                        }

                        return;
                    }

                    if (verbose) {
                        logger.debug(`found new token signature: ${signature}`);
                    }

                    let signer = '';
                    let baseAddress = '';
                    let baseDecimals = 0;
                    let baseLpAmount = 0;
                    let quoteAddress = '';
                    let quoteDecimals = 0;
                    let quoteLpAmount = 0;

                    /** You need to use a RPC provider for getParsedTransaction to work properly.
                     * Check README.md for suggestions https://github.com/archiesnipes/solana-new-token-monitor/blob/main/README.md
                     */
                    const parsedTransaction = await connection.getParsedTransaction(signature, {
                        maxSupportedTransactionVersion: 0,
                        commitment: 'confirmed',
                    });

                    if (parsedTransaction && parsedTransaction?.meta?.err == null) {
                        if (verbose) {
                            logger.verbose('successfully parsed transaction');
                        }

                        signer = parsedTransaction!.transaction.message.accountKeys[0].pubkey.toString();

                        if (verbose) {
                            logger.verbose(`creator, ${signer}`);
                        }

                        const postTokenBalances: TokenBalance[] = parsedTransaction!.meta!.postTokenBalances ?? [];

                        const baseInfo = postTokenBalances.find(
                            balance => balance.owner === raydiumAuthorityV4Account && balance.mint !== wrappedSolToken,
                        );

                        if (baseInfo) {
                            baseAddress = baseInfo.mint;
                            baseDecimals = baseInfo.uiTokenAmount.decimals;
                            baseLpAmount = baseInfo.uiTokenAmount.uiAmount ?? -99999999;
                        }

                        const quoteInfo = (postTokenBalances ?? []).find(
                            balance => balance.owner === raydiumAuthorityV4Account && balance.mint === wrappedSolToken,
                        );

                        if (quoteInfo) {
                            quoteAddress = quoteInfo.mint;
                            quoteDecimals = quoteInfo.uiTokenAmount.decimals;
                            quoteLpAmount = quoteInfo.uiTokenAmount.uiAmount ?? -99999999;
                        }
                    }

                    const newTokenData = {
                        lpSignature: signature,
                        creator: signer,
                        timestamp: new Date().toISOString(),
                        baseInfo: {
                            baseAddress,
                            baseDecimals,
                            baseLpAmount,
                        },
                        quoteInfo: {
                            quoteAddress: quoteAddress,
                            quoteDecimals: quoteDecimals,
                            quoteLpAmount: quoteLpAmount,
                        },
                        logs: logs,
                    };

                    await storeData(args.dataPath, newTokenData);
                } catch (error) {
                    const errorMessage = `error occured in new solana token log callback function, ${JSON.stringify(
                        error,
                        null,
                        2,
                    )}`;

                    if (verbose) {
                        logger.error(errorMessage);
                    }

                    // Save error logs to a separate file
                    fs.appendFile('errorNewLpsLogs.txt', `${errorMessage}\n`, function (err) {
                        if (err) {
                            if (verbose) {
                                logger.error('error writing errorlogs.txt', err);
                            }
                        }
                    });
                }
            },
            'confirmed',
        );
    } catch (error) {
        const errorMessage = `error occured in new sol lp monitor, ${JSON.stringify(error, null, 2)}`;
        if (verbose) {
            logger.error(errorMessage);
        }

        // Save error logs to a separate file
        fs.appendFile('errorNewLpsLogs.txt', `${errorMessage}\n`, function (err) {
            if (err) {
                if (verbose) {
                    logger.error('error writing errorlogs.txt', err);
                }
            }
        });
    }
}
