import { v4 as uuidv4 } from 'uuid';
import { Logger } from 'winston';

import { lamportsToSol } from '@src/blockchains/utils/amount';
import { ActorContext } from '@src/core/types';
import { getFiles } from '@src/data/getFiles';
import {
    createBacktestRun,
    formDraftMintResultFromBacktestMintResult,
    getBacktestStrategyResults,
    initBacktestStrategyResult,
    storeBacktest,
    updateBacktestRunStatus,
    updateBacktestStrategyResult,
} from '@src/db/repositories/backtests';
import { Backtest, BacktestStrategyResult, ProcessingStatus } from '@src/db/types';
import { ProtoBacktestMintFullResult } from '@src/protos/generated/backtests';
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

import { BacktestConfig } from './types';
import { StrategyResultLiveState, createInitialStrategyResultLiveState, logStrategyResult, runStrategy } from './utils';
import Pumpfun from '../../blockchains/solana/dex/pumpfun/Pumpfun';
import PumpfunBacktester from '../bots/blockchains/solana/PumpfunBacktester';
import {
    BacktestRunConfig,
    BacktestStrategyRunConfig,
    StrategyMintBacktestResult,
} from '../bots/blockchains/solana/types';

export default async function runAndSelectBestStrategy(
    {
        logger,
        pubsub,
        backtestPubSub,
    }: {
        logger: Logger;
        pubsub: PubSub;
        backtestPubSub: BacktestPubSub;
    },
    actorContext: ActorContext,
    config: BacktestConfig,
): Promise<void> {
    const start = process.hrtime();

    const pumpfun = new Pumpfun({
        rpcEndpoint: process.env.SOLANA_RPC_ENDPOINT as string,
        wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
    });
    const backtester = new PumpfunBacktester(logger);

    const backtestId = (config as { backtest?: Backtest })?.backtest?.id ?? uuidv4();
    let backtest: Backtest;
    let runConfig: BacktestRunConfig;
    if ((config as { backtest?: Backtest })?.backtest) {
        backtest = (config as { backtest: Backtest }).backtest;
        runConfig = backtest.config;
    } else {
        runConfig = (config as { runConfig: BacktestRunConfig }).runConfig;
        logger.info('Storing backtest with id %s', backtestId);
        backtest = {
            id: backtestId,
            chain: 'solana',
            config: runConfig,
        };
        await storeBacktest(backtest);
    }

    const backtestRun = await createBacktestRun({
        backtest_id: backtestId,
        source: actorContext.source,
        status: ProcessingStatus.Running,
        user_id: actorContext?.userId ?? null,
        api_client_id: actorContext?.apiClientId ?? null,
        started_at: new Date(),
    });
    backtestPubSub.publishBacktestRun({
        id: backtestRun.id.toString(),
        action: 'added',
        data: backtestRun,
        version: 1,
    });

    const files = getFiles(runConfig.data);
    const totalFiles = files.length;
    if (runConfig && runConfig.data.filesCount !== totalFiles) {
        throw new Error(
            `Cannot resume the existing backtest: expected ${runConfig.data.filesCount} file(s), but found ${totalFiles} file(s), config.data=${JSON.stringify(runConfig.data)}`,
        );
    }

    const strategiesCount = config.strategies.length;
    logger.info(
        'Started backtest with id %s%s against %d strategies, config=%o\n',
        backtestId,
        backtest.name ? `, name ${backtest.name}` : '',
        strategiesCount,
        backtest.config,
    );

    let tested = 0;

    let paused = false;
    let aborted = false;
    let abortRequestContext:
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
                    'Pause backtest run requested at strategy [%d], strategyResultId %s',
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
                    'Resume backtest run requested at strategy [%d], strategyResultId %s',
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
                    'Abort backtest run requested at strategy [%d], strategyResultId %s',
                    tested,
                    currentStrategyResultId,
                );
                abortRequestContext = {
                    ...command,
                    lastStrategyResultId: currentStrategyResultId,
                };
                aborted = true;
                break;
        }
    });

    for (const strategy of config.strategies) {
        // eslint-disable-next-line no-unmodified-loop-condition
        while (paused) {
            await sleep(150);
        }

        if (aborted) {
            logger.info('[%d] Aborting backtest run', tested);
            break;
        }

        const backtestStrategyRunConfig: BacktestStrategyRunConfig = {
            ...runConfig,
            strategy: strategy,
        };

        logger.info(
            '[%d] Will test strategy %s with variant config: %s against %d historical data, config=%o\n%s',
            tested,
            backtestStrategyRunConfig.strategy.identifier,
            backtestStrategyRunConfig.strategy.configVariant,
            totalFiles,
            backtestStrategyRunConfig.strategy.config,
            '='.repeat(100),
        );

        const runningPartialStrategyResult = await initBacktestStrategyResult(
            backtestId,
            backtestRun.id,
            backtestStrategyRunConfig.strategy,
            ProcessingStatus.Running,
        );
        backtestPubSub.publishBacktestStrategyResult(backtestId, strategy.identifier, {
            id: runningPartialStrategyResult.id.toString(),
            action: 'added',
            data: runningPartialStrategyResult,
            version: 1,
        } satisfies UpdateItem<BacktestStrategyResult>);

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
                abortedRef: () => aborted,
                ls: currentStrategyLiveState,
            },
            backtestStrategyRunConfig,
            files,
            {
                verbose: true,
                onMintResult: bmr => {
                    backtestPubSub.publishBacktestStrategyMintResult(
                        backtestId,
                        strategy.identifier,
                        strategyMintBacktestResultToDraftMintResult(runningPartialStrategyResult.id, bmr),
                    );
                },
            },
        );
        const executionTime = process.hrtime(strategyStartTime);
        const executionTimeInS = (executionTime[0] * 1e9 + executionTime[1]) / 1e9;

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
        const backtestStrategyResult: BacktestStrategyResult = {
            ...runningPartialStrategyResult,
            ...(await updateBacktestStrategyResult(
                runningPartialStrategyResult.id,
                !aborted ? ProcessingStatus.Completed : ProcessingStatus.Aborted,
                sr,
                executionTimeInS,
            )),
        };
        backtestPubSub.publishBacktestStrategyResult(backtestId, strategy.identifier, {
            id: backtestStrategyResult.id.toString(),
            action: 'updated',
            data: backtestStrategyResult,
            version: 2,
        } satisfies UpdateItem<BacktestStrategyResult>);

        tested++;
    }

    const bestStrategyResult = (
        await getBacktestStrategyResults(backtestId, {
            orderBy: {
                columnName: 'pnl_sol',
                order: 'desc',
            },
            limit: 1,
        })
    )[0];

    const diff = process.hrtime(start);
    const timeInNs = diff[0] * 1e9 + diff[1];

    backtestPubSub.publishBacktestRun({
        id: backtestRun.id.toString(),
        action: 'updated',
        data: {
            ...backtestRun,
            ...(await updateBacktestRunStatus(
                backtestRun.id,
                !aborted ? ProcessingStatus.Completed : ProcessingStatus.Aborted,
            )),
        },
        version: 2,
    });

    if (abortRequestContext) {
        await pubsub.publish(
            BACKTEST_COMMAND_RESPONSE_CHANNEL,
            JSON.stringify({
                correlationId: abortRequestContext.correlationId,
                backtestRunId: abortRequestContext.backtestRunId,
                finishedAt: new Date(),
                abortedStrategyResultIds:
                    abortRequestContext.lastStrategyResultId === null ? [] : [abortRequestContext.lastStrategyResultId],
            } satisfies AbortBacktestRunResponseMessage),
        );
    }

    logger.info('Finished testing %d strategies in %s', tested, formatElapsedTime(timeInNs / 1e9));
    logger.info(
        'The best strategy is: %s with variant config: %s, config: %o',
        bestStrategyResult.strategy_id,
        bestStrategyResult.config_variant,
        bestStrategyResult.config,
    );
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
