import * as crypto from 'crypto';
import fs from 'fs';

import { createLogger } from 'winston';

import { HandlePumpTokenReport } from './bot';
import Pumpfun from '../../blockchains/solana/dex/pumpfun/Pumpfun';
import { forceGetPumpCoinInitialData } from '../../blockchains/solana/dex/pumpfun/utils';
import { lamportsToSol, solToLamports } from '../../blockchains/utils/amount';
import { db } from '../../db/knex';
import { pumpfunRepository } from '../../db/repositories/PumpfunRepository';
import { logger } from '../../logger';
import PumpfunBacktester from '../../trading/bots/blockchains/solana/PumpfunBacktester';
import {
    BacktestExitResponse,
    BacktestRunConfig,
    BacktestTradeResponse,
    StrategyBacktestResult,
} from '../../trading/bots/blockchains/solana/types';
import { LaunchpadBotStrategy } from '../../trading/strategies/launchpads/LaunchpadBotStrategy';
import RiseStrategy from '../../trading/strategies/launchpads/RiseStrategy';
import StupidSniperStrategy from '../../trading/strategies/launchpads/StupidSniperStrategy';
import { FileInfo, walkDirFilesSyncRecursive } from '../../utils/files';
import { formDataFolder } from '../../utils/storage';

const cache: Record<string, HandlePumpTokenReport> = {};

(async () => {
    start().finally(() => {
        db.destroy();
    });
})();

/**
 * It will test the provided strategies against the history pumpfun data stored in data/pumpfun-stats
 */
async function start() {
    await findBestStrategy();
}

async function findBestStrategy() {
    const pumpfun = new Pumpfun({
        rpcEndpoint: process.env.SOLANA_RPC_ENDPOINT as string,
        wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
    });
    const silentLogger = createLogger({
        silent: true,
        transports: [],
    });
    const backtester = new PumpfunBacktester(logger);

    const pumpfunStatsPath = formDataFolder('pumpfun-stats');
    const files = walkDirFilesSyncRecursive(pumpfunStatsPath);

    const strategies: LaunchpadBotStrategy[] = [new RiseStrategy(silentLogger), new StupidSniperStrategy(silentLogger)];
    const results: {
        strategyId: string;
        result: StrategyBacktestResult;
    }[] = [];

    for (const strategy of strategies) {
        const runConfig: BacktestRunConfig = {
            initialBalanceLamports: solToLamports(1),
            strategy: strategy,
            buyAmountSol: 0.4,
            onlyOneFullTrade: true,
        };
        results.push({
            strategyId: formStrategyId(strategy),
            result: await runStrategy(
                {
                    backtester: backtester,
                    pumpfun: pumpfun,
                },
                runConfig,
                files,
            ),
        });
    }

    results.sort((a, b) => b.result.totalPnlInSol - a.result.totalPnlInSol);

    logger.info('The best strategy is %s', results[0].strategyId);
}

async function runStrategy(
    {
        backtester,
        pumpfun,
    }: {
        backtester: PumpfunBacktester;
        pumpfun: Pumpfun;
    },
    runConfig: BacktestRunConfig,
    files: FileInfo[],
    config?: {
        verbose?: boolean;
    },
): Promise<StrategyBacktestResult> {
    const verbose = config?.verbose ?? false;
    logger.info(
        'WIll test strategy %s against %d historical data\n%s',
        formStrategyId(runConfig.strategy),
        files.length,
        '='.repeat(100),
    );

    let processed = 0;
    const maxToProcess: number | null = null;

    let totalProfitLossLamports = 0;
    let totalRoi = 0;
    let totalTradesCount = 0;

    for (const file of files) {
        let content: HandlePumpTokenReport;
        if (cache[file.fullPath]) {
            content = cache[file.fullPath];
        } else {
            content = JSON.parse(fs.readFileSync(file.fullPath).toString()) as HandlePumpTokenReport;
            cache[file.fullPath] = content;
        }

        const initialCoinData = await forceGetPumpCoinInitialData(pumpfun, pumpfunRepository, content.mint);
        try {
            const r = await backtester.run(runConfig, initialCoinData, content.history);
            runConfig.strategy.resetState();

            if (verbose) {
                logger.info(
                    '[%d] Results for mint: %s, %s, %s',
                    processed,
                    initialCoinData.mint,
                    initialCoinData.name,
                    initialCoinData.symbol,
                );
            }

            if ((r as BacktestTradeResponse).tradeHistory) {
                const pr = r as BacktestTradeResponse;
                if (pr.tradeHistory.length > 0) {
                    totalProfitLossLamports += pr.profitLossLamports;
                    totalRoi += pr.roi;
                    totalTradesCount += pr.tradeHistory.length;

                    if (verbose) {
                        logger.info(
                            'Final balance: %s SOL and holdings %s',
                            lamportsToSol(pr.finalBalanceLamports),
                            pr.holdings,
                        );
                        logger.info('Profit/Loss: %s SOL', lamportsToSol(pr.profitLossLamports));
                        logger.info('Trades count %d', pr.tradeHistory.length);
                        logger.info('ROI %s%%', pr.roi);
                        logger.info('Max Drawdown: %s%%\n', pr.maxDrawdown);
                    }
                }
            } else {
                const pr = r as BacktestExitResponse;
                if (verbose) {
                    logger.info('Exited monitoring with code: %s, reason: %s\n', pr.exitCode, pr.exitReason);
                }
            }
        } catch (e) {
            logger.error('Error handling mint %s', initialCoinData.mint);
            logger.info(e);
        }

        processed++;

        if (processed === maxToProcess) {
            logger.info('Processed maxToProcess=%d files and will stop', maxToProcess);
            break;
        }
    }

    logger.info('Total Profit/Loss: %s SOL', lamportsToSol(totalProfitLossLamports));
    logger.info('Total ROI %s%%', totalRoi);
    logger.info('Total trades count %d\n', totalTradesCount);

    return {
        totalPnlInSol: lamportsToSol(totalProfitLossLamports),
        totalRoi: totalRoi,
        totalTrades: totalRoi,
    };
}

function formStrategyId(strategy: LaunchpadBotStrategy): string {
    return `${strategy.name}_${generateConfigHash(strategy.config)}`;
}

function generateConfigHash(config: object): string {
    const jsonString = JSON.stringify(config);

    return crypto.createHash('md5').update(jsonString).digest('hex').slice(0, 8);
}
