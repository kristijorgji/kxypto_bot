import { v4 as uuidv4 } from 'uuid';
import { Logger } from 'winston';

import { lamportsToSol } from '@src/blockchains/utils/amount';
import { ActorContext } from '@src/core/types';
import { getFiles } from '@src/data/getFiles';
import {
    createBacktestRun,
    deleteBacktestStrategyResultsByIds,
    formDraftMintResultFromBacktestMintResult,
    getBacktestStrategyResultsByIds,
    initBacktestStrategyResult,
    storeBacktest,
    updateBacktestRunCheckpoint,
    updateBacktestRunStatus,
    updateBacktestStrategyResult,
} from '@src/db/repositories/backtests';
import { Backtest, BacktestStrategyResult, ProcessingStatus } from '@src/db/types';
import { createPrefixedLogger } from '@src/logger/createPrefixedLogger';
import { ProtoBacktestMintFullResult, ProtoBacktestRun } from '@src/protos/generated/backtests';
import BacktestPubSub from '@src/pubsub/BacktestPubSub';
import PubSub from '@src/pubsub/PubSub';
import LaunchpadBotStrategy from '@src/trading/strategies/launchpads/LaunchpadBotStrategy';
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
import {
    BacktestRunCheckpoint,
    RunBacktestFromRunConfigParams,
    RunBacktestParams,
    isStrategyPermutation,
} from './types';
import Pumpfun from '../../blockchains/solana/dex/pumpfun/Pumpfun';
import PumpfunBacktester from '../bots/blockchains/solana/PumpfunBacktester';
import {
    BacktestConfig,
    BacktestStrategyRunConfig,
    StrategyBacktestResult,
    StrategyMintBacktestResult,
} from '../bots/blockchains/solana/types';

const MAX_STRATEGIES_FOR_MINT_STORAGE = 40;

type RankingMetric = keyof Pick<StrategyBacktestResult, 'totalRoi' | 'winRatePercentage'>;

const RANKING_METRICS: RankingMetric[] = ['totalRoi', 'winRatePercentage'];

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

    logger.info(
        'Provided config without the strategies=%s',
        JSON.stringify((({ strategies, ...rest }) => rest)(config), null, 2),
    );

    const isBestOnly = config?.storage?.strategyPersistence === 'best_only';
    const finalConfig = {
        storage: {
            strategyPersistence: config?.storage?.strategyPersistence ?? 'all',
            storeMintResults: config?.storage?.storeMintResults ?? (!isBestOnly && !isHeavyRun),
        },
        pubsub: {
            notifyRunUpdate: config?.pubsub?.notifyRunUpdate ?? true,
            notifyStrategyUpdate: config?.pubsub?.notifyStrategyUpdate ?? true,
            notifyMintResults: config?.pubsub?.notifyMintResults ?? !isHeavyRun, // Auto-mute noise
        },
        logging: {
            runStrategy: config?.logging?.runStrategy ?? {
                level: 'verbose',
                includeTrades: !isBestOnly,
                logInterval: isBestOnly ? 500 : 1,
            },
        },
    } satisfies Pick<RunBacktestParams, 'storage' | 'pubsub' | 'logging'>;

    logger.info('Calculated finalConfig=%o', finalConfig);

    let backtestRunUpdateVersion: number = 1;

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
        logger.info('Stored backtest run with id %s', backtestRun.id);
        if (finalConfig.pubsub.notifyRunUpdate) {
            await backtestPubSub.publishBacktestRun({
                id: backtestRun.id.toString(),
                action: 'added',
                data: backtestRun,
                version: backtestRunUpdateVersion++,
            });
        }
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
                    version: backtestRunUpdateVersion++,
                });
            }
        }
    }

    const backtestRunId = backtestRun.id;

    const files = getFiles(backtestConfig.data);
    const totalFiles = files.length;
    if (backtestConfig && backtestConfig.data.filesCount !== totalFiles) {
        throw new Error(
            `Cannot resume the existing backtest: expected ${backtestConfig.data.filesCount} file(s), but found ${totalFiles} file(s), config.data=${JSON.stringify(backtestConfig.data)}`,
        );
    }

    logger.info(
        '[%s] Started backtest with id %s%s against %d strategy entries, %d permutations, config=%o\n',
        backtestRunId,
        backtestId,
        backtest.name ? `, name ${backtest.name}` : '',
        config.strategies.length,
        strategiesCount,
        backtest.config,
    );

    let tested = 0;
    let permutationsTested = 0;

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
                if (command.backtestRunId !== backtestRunId) {
                    return;
                }
                logger.info(
                    '[%s] Pause backtest run requested at strategy [%d], strategyResultId %s',
                    backtestRunId,
                    tested,
                    currentStrategyResultId,
                );
                paused = true;
                break;
            case 'BACKTEST_RUN_RESUME':
                if (command.backtestRunId !== backtestRunId) {
                    return;
                }
                logger.info(
                    '[%s] Resume backtest run requested at strategy [%d], strategyResultId %s',
                    backtestRunId,
                    tested,
                    currentStrategyResultId,
                );
                paused = false;
                break;
            case 'BACKTEST_RUN_ABORT':
                if (command.backtestRunId !== backtestRunId) {
                    return;
                }
                logger.info(
                    '[%s] Abort backtest run requested at strategy [%d], strategyResultId %s',
                    backtestRunId,
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

    const { champions, championsRows } = await initializeRunState(config);
    let lastCheckpointTime = Date.now();
    const CHECKPOINT_INTERVAL_MS = 5 * 60e3;

    mainLoop: for (const item of config.strategies) {
        const isPermutation = item && typeof item === 'object' && 'generator' in item;
        const strategyIterable = isPermutation ? item.generator : [item];

        permutationsTested = 0;

        for (const strategy of strategyIterable) {
            if (config.checkpoint && tested < config.checkpoint.lastIterationIndex) {
                if (tested % 1000 === 0 || tested === config.checkpoint.lastIterationIndex) {
                    logger.info('[%s] Resuming... Skipped index %d', backtestRunId, tested);
                }

                tested++;
                if (isPermutation) {
                    permutationsTested++;
                }
                continue;
            }

            let runningPartialStrategyResult!: BacktestStrategyResult;

            // eslint-disable-next-line no-unmodified-loop-condition
            while (paused) {
                await sleep(150);
            }

            if (abortState.aborted || pubsubAborted) {
                logger.info('[%s][%d] Aborting backtest run', backtestRunId, tested);
                break mainLoop;
            }

            const backtestStrategyRunConfig: BacktestStrategyRunConfig = {
                ...backtestConfig,
                strategy: strategy,
            };

            logger.info(
                '[%s][%d]%sWill test strategy %s with variant config: %s against %d historical data, config=%o\n%s',
                backtestRunId,
                tested,
                isPermutation ? `[Permutation ${permutationsTested}/${item.permutationsCount}] ` : ' ',
                backtestStrategyRunConfig.strategy.identifier,
                backtestStrategyRunConfig.strategy.configVariant,
                totalFiles,
                backtestStrategyRunConfig.strategy.config,
                '='.repeat(100),
            );

            if (isBestOnly) {
                // Create the "Slots" only once on the first iteration
                await initChampionRows(
                    backtestPubSub,
                    championsRows,
                    backtestRunId,
                    backtestId,
                    backtestStrategyRunConfig.strategy,
                    finalConfig.pubsub.notifyRunUpdate,
                );

                /**
                 * In Best Only mode, we don't know WHICH row we will use until the
                 * strategy finishes and we see if it won any metrics.
                 * * However, if you need an ID for logging/telemetry right now,
                 * you usually use the ID of the 'Primary' champion (e.g., ROI).
                 */
                currentStrategyResultId = championsRows[RANKING_METRICS[0]]!.id;
            } else {
                // Mode 'all': Always create a new row
                runningPartialStrategyResult = await initAndDispatchStrategyResult(
                    backtestPubSub,
                    backtestRunId,
                    backtestId,
                    backtestStrategyRunConfig.strategy,
                    finalConfig.pubsub.notifyRunUpdate,
                );
                currentStrategyResultId = runningPartialStrategyResult.id;
            }

            const strategyStartTime = process.hrtime();

            currentStrategyLiveState = createInitialStrategyResultLiveState();
            const sr = await runStrategy(
                {
                    backtester: backtester,
                    pumpfun: pumpfun,
                    logger: createPrefixedLogger(
                        logger,
                        {
                            backtestRunId: backtestRunId,
                            index: tested,
                        },
                        context => `[${context.backtestRunId}][${context.index}]`,
                    ),
                },
                {
                    pausedRef: () => paused,
                    abortedRef: () => abortState.aborted || pubsubAborted,
                    ls: currentStrategyLiveState,
                },
                backtestStrategyRunConfig,
                files,
                {
                    logging: finalConfig.logging.runStrategy,
                    onMintResult: async bmr => {
                        if (finalConfig.pubsub.notifyMintResults) {
                            await backtestPubSub.publishBacktestStrategyMintResult(
                                backtestId,
                                strategy.identifier,
                                strategyMintBacktestResultToDraftMintResult(currentStrategyResultId!, bmr),
                            );
                        }
                    },
                },
            );
            const executionTime = process.hrtime(strategyStartTime);
            const executionTimeInS = (executionTime[0] * 1e9 + executionTime[1]) / 1e9;

            logStrategyResult(
                createPrefixedLogger(
                    logger,
                    {
                        backtestRunId: backtestRunId,
                        index: tested,
                    },
                    context => `[${context.backtestRunId}][${context.index}] `,
                ),
                {
                    strategyId: strategy.identifier,
                    tested: tested,
                    total: strategiesCount,
                    executionTimeInS: executionTimeInS,
                },
                sr,
            );

            const metricsWon: RankingMetric[] = [];
            if (isBestOnly) {
                for (const metric of RANKING_METRICS) {
                    const currentChampMetric = champions[metric];
                    // Compare current strategy (sr) against the stored champion scores
                    if (!currentChampMetric || sr[metric] > currentChampMetric.result[metric]) {
                        metricsWon.push(metric);
                    }
                }
            }

            // Proceed if we are saving everything OR if we found a new winner
            if (!isBestOnly || metricsWon.length > 0) {
                let baseObject: BacktestStrategyResult;

                if (isBestOnly) {
                    // --- 1. WIN SUMMARY LOGGING ---
                    const winSummary = metricsWon
                        .map(m => {
                            const oldVal = champions[m]?.result[m] ?? 0;
                            const newVal = sr[m];
                            const delta = newVal - oldVal;
                            // Formats as: totalRoi: 15.5 (+2.1)
                            return `${m}: ${newVal.toFixed(2)} (+${delta.toFixed(2)})`;
                        })
                        .join(' | ');

                    logger.info(
                        '\n[%s][%d] 🏆 NEW CHAMPION FOUND! [%s]\n   Metrics: %s\n   Strategy: %s | Variant: %s\n%s',
                        backtestRunId,
                        tested,
                        backtestId,
                        winSummary,
                        strategy.identifier,
                        backtestStrategyRunConfig.strategy.configVariant,
                        '-'.repeat(60),
                    );

                    // 2. PRIMARY CANDIDATE SELECTION
                    const primaryMetric = metricsWon[0];
                    const survivorRow = championsRows[primaryMetric]!;

                    // 3. SAFETY CHECK: Is this candidate row currently the champion for any metrics we did NOT win?
                    // If it is, we cannot overwrite it because we would lose the champion data for those other metrics.
                    const isSurvivorShared = RANKING_METRICS.some(m => {
                        const row = championsRows[m];
                        // It's shared if it has the same ID but the metric is NOT in our "won" list
                        return row && row.id === survivorRow.id && !metricsWon.includes(m);
                    });

                    if (isSurvivorShared) {
                        // BRANCHING: We cannot recycle the old row. We must create a fresh one.
                        baseObject = await initAndDispatchStrategyResult(
                            backtestPubSub,
                            backtestRunId,
                            backtestId,
                            backtestStrategyRunConfig.strategy,
                            finalConfig.pubsub.notifyRunUpdate,
                        );
                    } else {
                        // RECYCLING: The row is exclusive to the metrics we just won (or subsets of them).
                        // It is safe to overwrite this row.
                        baseObject = survivorRow;
                    }

                    // 4. SMART CLEANUP
                    // We might have won metrics that were previously held by *different* rows.
                    // We need to check if those rows are now obsolete.
                    const otherRowsToConsider = metricsWon
                        .map(m => championsRows[m])
                        .filter(
                            (r): r is BacktestStrategyResult => r !== null && r !== undefined && r.id !== baseObject.id,
                        );

                    // Deduplicate IDs before checking
                    const candidateIdsToDelete = [...new Set(otherRowsToConsider.map(r => r.id))];
                    const idsToDelete: number[] = [];

                    for (const id of candidateIdsToDelete) {
                        // Check if this row is still needed by ANY metric we did NOT win
                        const isStillNeeded = RANKING_METRICS.some(m => {
                            const row = championsRows[m];
                            return row && row.id === id && !metricsWon.includes(m);
                        });

                        // Only delete if it is completely superseded
                        if (!isStillNeeded) {
                            idsToDelete.push(id);
                        }
                    }

                    if (idsToDelete.length > 0) {
                        await deleteBacktestStrategyResultsByIds(idsToDelete);
                    }

                    // 5. Update local champion score tracker
                    for (const metric of metricsWon) {
                        champions[metric] = {
                            configVariant: strategy.configVariant,
                            config: strategy.config,
                            result: sr,
                        };
                    }
                } else {
                    // Standard 'all' mode logic
                    baseObject = runningPartialStrategyResult;
                }

                const updatedResult: BacktestStrategyResult = {
                    ...baseObject,
                    ...(await updateBacktestStrategyResult(
                        baseObject.id,
                        !(abortState.aborted || pubsubAborted) ? ProcessingStatus.Completed : ProcessingStatus.Aborted,
                        sr,
                        executionTimeInS,
                        { storeMintsResults: finalConfig.storage.storeMintResults },
                    )),
                };

                // Update local pointers so the NEXT strategy compares against this new winner
                if (isBestOnly) {
                    for (const metric of metricsWon) {
                        championsRows[metric] = updatedResult;
                    }
                }

                if (finalConfig.pubsub.notifyStrategyUpdate) {
                    await backtestPubSub.publishBacktestStrategyResult(backtestId, strategy.identifier, {
                        id: updatedResult.id.toString(),
                        action: 'updated',
                        data: updatedResult,
                        version: 2,
                    } satisfies UpdateItem<BacktestStrategyResult>);
                }
            }

            tested++;
            if (isPermutation) {
                permutationsTested++;
            }

            // --- Store checkpoint for BestOnly mode ---
            if (isBestOnly) {
                const now = Date.now();
                const isTimeForHeartbeat = now - lastCheckpointTime > CHECKPOINT_INTERVAL_MS;
                const foundNewWinner = metricsWon.length > 0;

                if (foundNewWinner || isTimeForHeartbeat) {
                    const checkpoint = createCheckpoint(tested, permutationsTested, champions, championsRows);
                    await updateBacktestRunCheckpoint(backtestRunId, checkpoint);
                    if (finalConfig.pubsub.notifyRunUpdate) {
                        await backtestPubSub.publishBacktestRun({
                            id: backtestRunId.toString(),
                            action: 'updated',
                            data: {
                                ...backtestRun,
                                checkpoint: checkpoint,
                            },
                            version: backtestRunUpdateVersion++,
                        });
                    }

                    lastCheckpointTime = now;

                    if (foundNewWinner) {
                        logger.debug('[%s] 🚀 Checkpoint: New winner(s) persisted.', backtestRunId);
                    } else {
                        logger.info(
                            '[%s][%d] 💓 Heartbeat: Checkpoint saved at %s minutes.',
                            backtestRunId,
                            tested,
                            (CHECKPOINT_INTERVAL_MS / 60000).toFixed(0),
                        );
                    }
                }
            }
        }
    }

    const diff = process.hrtime(start);
    const timeInNs = diff[0] * 1e9 + diff[1];

    logger.info('[%s] Finished testing %d strategies in %s', backtestRunId, tested, formatElapsedTime(timeInNs / 1e9));

    // --- Update Backtest Run Final Status And Save Final Checkpoint For BestOnly Mode ---
    let finalCheckpoint = isBestOnly
        ? createCheckpoint(tested, permutationsTested, champions, championsRows)
        : undefined;
    backtestRun = {
        ...backtestRun!,
        ...(await updateBacktestRunStatus(
            backtestRunId,
            !(abortState.aborted || pubsubAborted) ? ProcessingStatus.Completed : ProcessingStatus.Aborted,
            finalCheckpoint,
        )),
        checkpoint: finalCheckpoint,
    };
    if (finalConfig.pubsub.notifyRunUpdate) {
        await backtestPubSub.publishBacktestRun({
            id: backtestRunId.toString(),
            action: 'updated',
            data: backtestRun,
            version: backtestRunUpdateVersion++,
        });
    }

    // --- If we were in best_only mode and didn't store mints during the loop... ---
    if (isBestOnly && !finalConfig.storage.storeMintResults) {
        logger.info('[%s] Backtest finished. Saving final champion mints...', backtestRunId);

        // Identify all unique champion rows that need a final update
        const uniqueChampionRows = new Map<
            number,
            { row: BacktestStrategyResult; data: NonNullable<Champions[RankingMetric]> }
        >();

        for (const metric of RANKING_METRICS) {
            const row = championsRows[metric];
            const data = champions[metric];

            if (row && data) {
                uniqueChampionRows.set(row.id, { row, data });
            }
        }

        // Perform the update for each unique row
        for (const { row, data } of uniqueChampionRows.values()) {
            if (!data.result.mintResults) {
                logger.info(
                    '[%s] 💾 Champion row %d (%s) was rehydrated from checkpoint. Skipping final mint results persistence as they were not stored in the session snapshot.',
                    backtestRunId,
                    row.id,
                    row.config_variant,
                );
                continue;
            }

            await updateBacktestStrategyResult(
                row.id,
                ProcessingStatus.Completed,
                data.result,
                row.execution_time_seconds,
                { storeMintsResults: true }, // Force save for the final winner
            );
        }
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

    // --- Final Hall of Fame Summary For BestOnly Mode ---
    if (isBestOnly) {
        logHallOfFame(logger, championsRows, champions);
    }
}

export function strategyMintBacktestResultToDraftMintResult(
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

type Champions = Partial<
    Record<
        RankingMetric,
        {
            configVariant: string;
            config: Record<string, unknown>;
            result: StrategyBacktestResult;
        }
    >
>;

type ChampionsRows = Partial<Record<RankingMetric, BacktestStrategyResult>>;

async function initializeRunState(config: RunBacktestParams): Promise<{
    champions: Champions;
    championsRows: ChampionsRows;
}> {
    const state: Awaited<ReturnType<typeof initializeRunState>> = {
        champions: {},
        championsRows: {},
    };

    const checkpoint = config.checkpoint;
    if (!checkpoint || !checkpoint.champions) return state;

    for (const [metric, data] of Object.entries(checkpoint.champions)) {
        const m = metric as RankingMetric;
        state.champions[m] = {
            // placeholders, will be filled once row is fetched
            configVariant: '',
            config: {},
            result: data.state as StrategyBacktestResult,
        };
        // Temporary skeleton for ID extraction
        state.championsRows[m] = { id: data.id } as BacktestStrategyResult;
    }

    const ids = Object.values(state.championsRows).map(e => e.id);

    if (ids.length > 0) {
        const fetchedRowsById = (await getBacktestStrategyResultsByIds(ids)).reduce<
            Record<number, BacktestStrategyResult>
        >((acc, row) => {
            acc[row.id] = row;
            return acc;
        }, {});

        for (const metric of Object.keys(state.championsRows)) {
            const m = metric as RankingMetric;
            const originalId = state.championsRows[m]!.id;
            const fullRow = fetchedRowsById[originalId];

            if (fullRow) {
                state.championsRows[m] = fullRow;
                state.champions[m]!.config = fullRow.config;
                state.champions[m]!.configVariant = fullRow.config_variant;
            } else {
                // If the DB row is gone, we should probably treat this metric
                // as uninitialized so the backtest doesn't try to update a non-existent ID.
                delete state.championsRows[m];
                delete state.champions[m];
                throw new Error(`[Checkpoint] Row ${originalId} for ${m} not found in DB. Resetting metric.`);
            }
        }
    }

    return state;
}

/**
 * Generates the checkpoint object to be saved in the DB or a file.
 */
function createCheckpoint(
    tested: number,
    permutationsTested: number,
    champions: Champions,
    championsRows: ChampionsRows,
): BacktestRunCheckpoint {
    const checkpointChampions: BacktestRunCheckpoint['champions'] = {};

    for (const metric of RANKING_METRICS) {
        const row = championsRows[metric];
        const state = champions[metric];
        if (row && state) {
            checkpointChampions[metric] = {
                id: row.id,
                state: state.result,
            };
        }
    }

    return {
        lastIterationIndex: tested,
        lastPermutationIterationIndex: permutationsTested,
        champions: checkpointChampions,
    };
}

async function initChampionRows(
    backtestPubSub: BacktestPubSub,
    championsRows: ChampionsRows,
    backtestRunId: number,
    backtestId: string,
    strategy: LaunchpadBotStrategy,
    dispatchPubsub: boolean,
): Promise<void> {
    const hasEmptySlots = RANKING_METRICS.some(m => !championsRows[m]);

    if (!hasEmptySlots) {
        return;
    }

    /** * We only reach this if we are starting fresh OR if
     * some metrics were missing from the checkpoint.
     */
    const sharedInitialResult = await initAndDispatchStrategyResult(
        backtestPubSub,
        backtestRunId,
        backtestId,
        strategy,
        dispatchPubsub,
    );

    for (const metric of RANKING_METRICS) {
        // Only assign if the metric doesn't already have a champion (important for resumes)
        if (!championsRows[metric]) {
            championsRows[metric] = sharedInitialResult;
        }
    }
}

async function initAndDispatchStrategyResult(
    backtestPubSub: BacktestPubSub,
    backtestRunId: number,
    backtestId: string,
    strategy: LaunchpadBotStrategy,
    dispatchPubsub: boolean,
): Promise<BacktestStrategyResult> {
    const strategyResult = await initBacktestStrategyResult(
        backtestId,
        backtestRunId,
        strategy,
        ProcessingStatus.Running,
    );

    if (dispatchPubsub) {
        const id = strategyResult.id.toString();
        await backtestPubSub.publishBacktestStrategyResult(backtestId, id, {
            id: id,
            action: 'added',
            data: strategyResult,
            version: 1,
        } satisfies UpdateItem<BacktestStrategyResult>);
    }

    return strategyResult;
}

function logHallOfFame(logger: Logger, championsRows: ChampionsRows, champions: Champions): void {
    logger.info('\n' + '='.repeat(60));
    logger.info('🏁 BACKTEST COMPLETE - FINAL CHAMPIONS');
    logger.info('='.repeat(60));

    // Create a unique set of winners to avoid printing the same strategy multiple times
    const finalWinners = new Map<
        number,
        {
            metrics: RankingMetric[];
            data: NonNullable<Champions[RankingMetric]>;
        }
    >();

    for (const metric of RANKING_METRICS) {
        const row = championsRows[metric];
        const data = champions[metric];

        if (row && data) {
            const existing = finalWinners.get(row.id);
            if (existing) {
                existing.metrics.push(metric);
            } else {
                finalWinners.set(row.id, { metrics: [metric], data });
            }
        }
    }

    finalWinners.forEach(({ metrics, data }, id) => {
        logger.info(`🏆 [${metrics.join(' & ')}]`);
        logger.info(`   ID: ${id}`);
        logger.info(`   Result: ${metrics.map(m => `${m}: ${data.result[m].toFixed(4)}`).join(' | ')}`);
        logger.info(`   Variant: ${data.configVariant}`);
        logger.info(`   Config: ${JSON.stringify(data.config)}`);
        logger.info('-'.repeat(30));
    });

    logger.info('='.repeat(60) + '\n');
}
