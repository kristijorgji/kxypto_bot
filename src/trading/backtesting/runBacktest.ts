import { v4 as uuidv4 } from 'uuid';
import { Logger } from 'winston';

import { lamportsToSol } from '@src/blockchains/utils/amount';
import { ActorContext } from '@src/core/types';
import { getFiles } from '@src/data/getFiles';
import {
    createBacktestRun,
    formDraftMintResultFromBacktestMintResult,
    initBacktestStrategyResult,
    storeBacktest,
    updateBacktestRunStatus,
    updateBacktestStrategyResult,
} from '@src/db/repositories/backtests';
import { Backtest, BacktestStrategyResult, ProcessingStatus } from '@src/db/types';
import { ProtoBacktestMintFullResult, ProtoBacktestRun } from '@src/protos/generated/backtests';
import BacktestPubSub from '@src/pubsub/BacktestPubSub';
import PubSub from '@src/pubsub/PubSub';
import { sleep } from '@src/utils/functions';
import { formatElapsedTime } from '@src/utils/time';
import {
    AbortBacktestRunResponseMessage,
    BACKTEST_COMMAND_REQUEST_CHANNEL,
    BACKTEST_COMMAND_RESPONSE_CHANNEL,
    BacktestCommandMessage,
    BacktestRunAbortRequestMessage,
    BacktestStrategyResultStatusResponseMessage,
} from '@src/ws-api/ipc/types';
import { UpdateItem } from '@src/ws-api/types';

import {
    StrategyResultLiveState,
    createInitialStrategyResultLiveState,
    logStrategyResult,
    runStrategy,
} from './runStrategy';
import { RunBacktestFromRunConfigParams, RunBacktestParams, isStrategyPermutation } from './types';
import Pumpfun from '../../blockchains/solana/dex/pumpfun/Pumpfun';
import PumpfunBacktester from '../bots/blockchains/solana/PumpfunBacktester';
import {
    BacktestConfig,
    BacktestStrategyRunConfig,
    StrategyBacktestResult,
    StrategyMintBacktestResult,
} from '../bots/blockchains/solana/types';

const MAX_STRATEGIES_FOR_MINT_STORAGE = 40;

/**
 * It will run a single Backtest from a
 *  temporary config          - it will create a run and backtest automatically in database
 *  an existing backtest      - it will create a run automatically
 *  an existing run (queued)  - it will use the existing provided run and backtest config, and update states accordingly
 */
export default async function runBacktest(
    {
        logger,
        pubsub,
        backtestPubSub,
        pumpfun,
        backtester,
    }: {
        logger: Logger;
        pubsub: PubSub;
        backtestPubSub: BacktestPubSub;
        pumpfun: Pumpfun;
        backtester: PumpfunBacktester;
    },
    actorContext: ActorContext,
    config: RunBacktestParams,
    abortState: {
        aborted: boolean;
    },
): Promise<void> {
    const start = process.hrtime();

    let backtestRun: ProtoBacktestRun | undefined = undefined;
    const backtestId = (config as { backtest?: Backtest })?.backtest?.id ?? uuidv4();
    let backtest: Backtest;
    let backtestConfig: BacktestConfig;

    if ((config as RunBacktestFromRunConfigParams).backtestRun) {
        const pc = config as RunBacktestFromRunConfigParams;
        backtestRun = pc.backtestRun;
        backtest = pc.backtest;
        backtestConfig = pc.backtest.config;
    } else if ((config as { backtest?: Backtest })?.backtest) {
        backtest = (config as { backtest: Backtest }).backtest;
        backtestConfig = backtest.config;
    } else {
        backtestConfig = (config as { backtestConfig: BacktestConfig }).backtestConfig;
        logger.info('Storing backtest with id %s', backtestId);
        backtest = {
            id: backtestId,
            chain: 'solana',
            config: backtestConfig,
        };
        await storeBacktest(backtest);
    }

    const strategiesCount = config.strategies.reduce((previousValue, currentValue) => {
        return previousValue + (isStrategyPermutation(currentValue) ? currentValue.permutationsCount : 1);
    }, 0);

    const isHeavyRun = strategiesCount > MAX_STRATEGIES_FOR_MINT_STORAGE;

    const finalConfig = {
        storage: {
            strategyPersistence: config?.storage?.strategyPersistence ?? 'all',
            storeMintResults: config?.storage?.storeMintResults ?? !isHeavyRun,
        },
        pubsub: {
            notifyRunUpdate: config?.pubsub?.notifyRunUpdate ?? true,
            notifyStrategyUpdate: config?.pubsub?.notifyStrategyUpdate ?? true,
            notifyMintResults: config?.pubsub?.notifyMintResults ?? !isHeavyRun, // Auto-mute noise
        },
    };
    const isBestOnly = finalConfig.storage.strategyPersistence === 'best_only';
    finalConfig.storage.storeMintResults = config?.storage?.storeMintResults ?? !isBestOnly;

    if (config?.storage?.storeMintResults === undefined && isHeavyRun) {
        logger.info(
            `Large run detected (${strategiesCount} items). Auto-disabling detailed mint results and pubsub storage to save resources.`,
        );
    }

    if (!backtestRun) {
        backtestRun = await createBacktestRun({
            backtest_id: backtestId,
            source: actorContext.source,
            status: ProcessingStatus.Running,
            user_id: actorContext?.userId ?? null,
            api_client_id: actorContext?.apiClientId ?? null,
            started_at: new Date(),
            config: {},
        });
        if (finalConfig.pubsub.notifyRunUpdate) {
            await backtestPubSub.publishBacktestRun({
                id: backtestRun.id.toString(),
                action: 'added',
                data: backtestRun,
                version: 1,
            });
        }
        logger.info('Storing and dispatched backtest run with id %s', backtestRun.id);
    } else {
        if (backtestRun.status === ProcessingStatus.Pending) {
            if (finalConfig.pubsub.notifyRunUpdate) {
                await backtestPubSub.publishBacktestRun({
                    id: backtestRun.id.toString(),
                    action: 'updated',
                    data: {
                        ...backtestRun,
                        ...(await updateBacktestRunStatus(backtestRun.id, ProcessingStatus.Running)),
                    },
                    version: 2,
                });
            }
        }
    }

    const files = getFiles(backtestConfig.data);
    const totalFiles = files.length;
    if (backtestConfig && backtestConfig.data.filesCount !== totalFiles) {
        throw new Error(
            `Cannot resume the existing backtest: expected ${backtestConfig.data.filesCount} file(s), but found ${totalFiles} file(s), config.data=${JSON.stringify(backtestConfig.data)}`,
        );
    }

    logger.info(
        '[%s] Started backtest with id %s%s against %d strategy entries, %d permutations, config=%o\n',
        backtestRun.id,
        backtestId,
        backtest.name ? `, name ${backtest.name}` : '',
        config.strategies.length,
        strategiesCount,
        backtest.config,
    );

    let tested = 0;

    let paused = false;
    let pubsubAborted = false;
    let pubsubAbortRequestContext:
        | (BacktestRunAbortRequestMessage & {
              lastStrategyResultId: number | null;
          })
        | undefined;
    let currentStrategyResultId: number | null = null;
    let currentStrategyLiveState: StrategyResultLiveState | undefined;

    await pubsub.subscribe(BACKTEST_COMMAND_REQUEST_CHANNEL, async raw => {
        const command = JSON.parse(raw) as BacktestCommandMessage;

        switch (command.type) {
            case 'STRATEGY_RESULT_STATUS_REQUEST':
                if (
                    !currentStrategyResultId ||
                    !currentStrategyLiveState ||
                    command.strategyResultId !== currentStrategyResultId
                ) {
                    return;
                }
                await pubsub.publish(
                    BACKTEST_COMMAND_RESPONSE_CHANNEL,
                    JSON.stringify({
                        correlationId: command.correlationId,
                        strategyResultId: currentStrategyResultId,
                        mintIndex: currentStrategyLiveState.currentIndex,
                        pnl: lamportsToSol(currentStrategyLiveState.totalProfitLossLamports),
                        roi: currentStrategyLiveState.roi,
                        holdingsValue: lamportsToSol(currentStrategyLiveState.holdingsValueInLamports),
                        winRate: currentStrategyLiveState.winRatePercentage,
                        winsCount: currentStrategyLiveState.winsCount,
                        lossesCount: currentStrategyLiveState.lossesCount,
                        totalTradesCount: currentStrategyLiveState.totalTradesCount,
                        buyTradesCount: currentStrategyLiveState.totalBuyTradesCount,
                        sellTradesCount: currentStrategyLiveState.totalSellTradesCount,
                    } satisfies BacktestStrategyResultStatusResponseMessage),
                );
                break;
            case 'BACKTEST_RUN_PAUSE':
                if (command.backtestRunId !== backtestRun.id) {
                    return;
                }
                logger.info(
                    '[%s] Pause backtest run requested at strategy [%d], strategyResultId %s',
                    backtestRun.id,
                    tested,
                    currentStrategyResultId,
                );
                paused = true;
                break;
            case 'BACKTEST_RUN_RESUME':
                if (command.backtestRunId !== backtestRun.id) {
                    return;
                }
                logger.info(
                    '[%s] Resume backtest run requested at strategy [%d], strategyResultId %s',
                    backtestRun.id,
                    tested,
                    currentStrategyResultId,
                );
                paused = false;
                break;
            case 'BACKTEST_RUN_ABORT':
                if (command.backtestRunId !== backtestRun.id) {
                    return;
                }
                logger.info(
                    '[%s] Abort backtest run requested at strategy [%d], strategyResultId %s',
                    backtestRun.id,
                    tested,
                    currentStrategyResultId,
                );
                pubsubAbortRequestContext = {
                    ...command,
                    lastStrategyResultId: currentStrategyResultId,
                };
                pubsubAborted = true;
                break;
        }
    });

    let championRow: BacktestStrategyResult | null = null;
    let champion: StrategyBacktestResult | null = null;

    // 'mainLoop' is a label that allows us to break out of nested loops entirely
    mainLoop: for (const item of config.strategies) {
        const isPermutation = item && typeof item === 'object' && 'generator' in item;
        const strategyIterable = isPermutation ? item.generator : [item];

        let permutationsTested = 0;

        for (const strategy of strategyIterable) {
            let runningPartialStrategyResult!: BacktestStrategyResult;

            // eslint-disable-next-line no-unmodified-loop-condition
            while (paused) {
                await sleep(150);
            }

            if (abortState.aborted || pubsubAborted) {
                logger.info('[%s][%d] Aborting backtest run', backtestRun.id, tested);
                break mainLoop;
            }

            const backtestStrategyRunConfig: BacktestStrategyRunConfig = {
                ...backtestConfig,
                strategy: strategy,
            };

            logger.info(
                '[%s][%d] %sWill test strategy %s with variant config: %s against %d historical data, config=%o\n%s',
                backtestRun.id,
                tested,
                isPermutation ? `[Permutation ${permutationsTested}/${item.permutationsCount}] ` : '',
                backtestStrategyRunConfig.strategy.identifier,
                backtestStrategyRunConfig.strategy.configVariant,
                totalFiles,
                backtestStrategyRunConfig.strategy.config,
                '='.repeat(100),
            );

            if (isBestOnly) {
                // Create the "Slot" only once on the first iteration
                if (!championRow) {
                    runningPartialStrategyResult = await initBacktestStrategyResult(
                        backtestId,
                        backtestRun.id,
                        backtestStrategyRunConfig.strategy,
                        ProcessingStatus.Running,
                    );
                    championRow = runningPartialStrategyResult;

                    // Broadcast 'added' ONLY ONCE for the champion slot
                    if (finalConfig.pubsub.notifyStrategyUpdate) {
                        await publishStrategyResultAdded(backtestPubSub, backtestId, runningPartialStrategyResult);
                    }
                }
            } else {
                // Mode 'all': Always create a new row
                runningPartialStrategyResult = await initBacktestStrategyResult(
                    backtestId,
                    backtestRun.id,
                    backtestStrategyRunConfig.strategy,
                    ProcessingStatus.Running,
                );

                if (finalConfig.pubsub.notifyStrategyUpdate) {
                    await publishStrategyResultAdded(backtestPubSub, backtestId, runningPartialStrategyResult);
                }
            }

            const strategyStartTime = process.hrtime();

            currentStrategyResultId = runningPartialStrategyResult.id;
            currentStrategyLiveState = createInitialStrategyResultLiveState();
            const sr = await runStrategy(
                {
                    backtester: backtester,
                    pumpfun: pumpfun,
                    logger: logger,
                },
                {
                    pausedRef: () => paused,
                    abortedRef: () => abortState.aborted || pubsubAborted,
                    ls: currentStrategyLiveState,
                },
                backtestStrategyRunConfig,
                files,
                {
                    logging: config?.logging?.runStrategy ?? {
                        level: 'verbose',
                        includeTrades: true,
                    },
                    onMintResult: async bmr => {
                        if (finalConfig.pubsub.notifyMintResults) {
                            await backtestPubSub.publishBacktestStrategyMintResult(
                                backtestId,
                                strategy.identifier,
                                strategyMintBacktestResultToDraftMintResult(runningPartialStrategyResult.id, bmr),
                            );
                        }
                    },
                },
            );
            const executionTime = process.hrtime(strategyStartTime);
            const executionTimeInS = (executionTime[0] * 1e9 + executionTime[1]) / 1e9;

            // If 'all', we always update. If 'best_only', we check if it's the first run OR a new high score.
            const isNewWinner = !champion || sr.totalPnlInSol > champion.totalPnlInSol;

            logStrategyResult(
                logger,
                {
                    strategyId: strategy.identifier,
                    tested: tested,
                    total: strategiesCount,
                    executionTimeInS: executionTimeInS,
                },
                sr,
            );

            if (!isBestOnly || isNewWinner) {
                if (isBestOnly) {
                    champion = sr;
                }

                const backtestStrategyResult: BacktestStrategyResult = {
                    ...runningPartialStrategyResult,
                    ...(await updateBacktestStrategyResult(
                        runningPartialStrategyResult.id,
                        !(abortState.aborted || pubsubAborted) ? ProcessingStatus.Completed : ProcessingStatus.Aborted,
                        sr,
                        executionTimeInS,
                        {
                            storeMintsResults: finalConfig.storage.storeMintResults,
                        },
                    )),
                };
                if (finalConfig.pubsub.notifyStrategyUpdate) {
                    await backtestPubSub.publishBacktestStrategyResult(backtestId, strategy.identifier, {
                        id: backtestStrategyResult.id.toString(),
                        action: 'updated',
                        data: backtestStrategyResult,
                        version: 2,
                    } satisfies UpdateItem<BacktestStrategyResult>);
                }
            }

            tested++;
            if (isPermutation) {
                permutationsTested++;
            }
        }
    }

    const diff = process.hrtime(start);
    const timeInNs = diff[0] * 1e9 + diff[1];

    if (finalConfig.pubsub.notifyRunUpdate) {
        await backtestPubSub.publishBacktestRun({
            id: backtestRun.id.toString(),
            action: 'updated',
            data: {
                ...backtestRun,
                ...(await updateBacktestRunStatus(
                    backtestRun.id,
                    !(abortState.aborted || pubsubAborted) ? ProcessingStatus.Completed : ProcessingStatus.Aborted,
                )),
            },
            version: 2,
        });
    }

    // If we were in best_only mode and didn't store mints during the loop...
    if (isBestOnly && !finalConfig.storage.storeMintResults && champion) {
        logger.info('Backtest finished. Saving final champion mints...');

        // Perform one final update to the champion row to save the winning mints
        await updateBacktestStrategyResult(
            championRow!.id,
            ProcessingStatus.Completed,
            champion,
            championRow!.execution_time_seconds,
            { storeMintsResults: true }, // Force save for the final winner
        );
    }

    if (pubsubAbortRequestContext) {
        await pubsub.publish(
            BACKTEST_COMMAND_RESPONSE_CHANNEL,
            JSON.stringify({
                correlationId: pubsubAbortRequestContext.correlationId,
                backtestRunId: pubsubAbortRequestContext.backtestRunId,
                finishedAt: new Date(),
                abortedStrategyResultIds:
                    pubsubAbortRequestContext.lastStrategyResultId === null
                        ? []
                        : [pubsubAbortRequestContext.lastStrategyResultId],
            } satisfies AbortBacktestRunResponseMessage),
        );
    }

    logger.info('[%s] Finished testing %d strategies in %s', backtestRun.id, tested, formatElapsedTime(timeInNs / 1e9));
}

function strategyMintBacktestResultToDraftMintResult(
    strategyResultId: number,
    bmr: StrategyMintBacktestResult,
): ProtoBacktestMintFullResult {
    const dmr = formDraftMintResultFromBacktestMintResult(strategyResultId, bmr);

    return {
        id: 0, // temporary id for mint results that aren't persisted yet
        strategy_result_id: dmr.strategy_result_id,
        index: dmr.index,
        mint: dmr.mint,
        net_pnl: dmr.net_pnl_sol ?? undefined,
        holdings_value: dmr.holdings_value_sol ?? undefined,
        roi: dmr.roi ?? undefined,
        exit_code: dmr.exit_code ?? undefined,
        exit_reason: dmr.exit_reason ?? undefined,
        payload: dmr.payload,
        created_at: dmr.created_at,
    };
}

async function publishStrategyResultAdded(
    backtestPubSub: BacktestPubSub,
    backtestId: string,
    strategyResult: BacktestStrategyResult,
): Promise<void> {
    const id = strategyResult.id.toString();

    await backtestPubSub.publishBacktestStrategyResult(backtestId, id, {
        id: id,
        action: 'added',
        data: strategyResult,
        version: 1,
    } satisfies UpdateItem<BacktestStrategyResult>);
}
