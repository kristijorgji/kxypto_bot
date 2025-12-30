import { HistoryEntry, MarketContext } from '../../bots/launchpads/types';
import { ShouldExitMonitoringResponse } from '../../bots/types';
import { IntervalConfig, LaunchpadBuyPosition, LaunchpadStrategyBuyConfig } from '../types';

export function shouldBuyStateless(buyConfig: LaunchpadStrategyBuyConfig, marketContext: MarketContext): boolean {
    for (const key in marketContext) {
        if (!checkInterval(buyConfig[key as keyof MarketContext], marketContext[key as keyof MarketContext])) {
            return false;
        }
    }

    return true;
}

export function checkInterval(config: IntervalConfig | undefined, value: number | null): boolean {
    let valid = true;

    if (!config) {
        return true;
    }

    if (value === null) {
        return !config || Object.keys(config).length === 0;
    }

    if (config.min) {
        valid &&= value >= config.min;
    }

    if (config.max) {
        valid &&= value <= config.max;
    }

    return valid;
}

export function shouldExitLaunchpadToken(
    { price, marketCap, holdersCount, bondingCurveProgress }: MarketContext,
    history: HistoryEntry[],
    {
        elapsedMonitoringMs,
    }: {
        elapsedMonitoringMs: number;
    },
    buyPosition: LaunchpadBuyPosition | undefined,
    maxWaitMs: number,
): ShouldExitMonitoringResponse {
    const mcDiffFromInitialPercentage = ((marketCap - history[0].marketCap) / history[0].marketCap) * 100;

    let res: ShouldExitMonitoringResponse = false;

    let maxPreviousHolders = holdersCount;
    for (let i = 0; i < history.length - 1; i++) {
        if (history[i].holdersCount >= maxPreviousHolders) {
            maxPreviousHolders = history[i].holdersCount;
        }
    }

    let dumpReason:
        | 'lower_mc_than_initial'
        | 'lower_price_than_initial'
        | 'less_holders_and_mc_than_initial'
        | 'less_mc_and_few_holders'
        | undefined;

    if (price < history[0].price) {
        dumpReason = 'lower_price_than_initial';
    } else if (mcDiffFromInitialPercentage < -6 && holdersCount <= 30 && bondingCurveProgress <= 35) {
        dumpReason = 'lower_mc_than_initial';
    } else if (
        marketCap < history[0].marketCap &&
        holdersCount <= 3 &&
        maxPreviousHolders > holdersCount &&
        elapsedMonitoringMs >= 60 * 1e3
    ) {
        dumpReason = 'less_holders_and_mc_than_initial';
    } else if (mcDiffFromInitialPercentage < -5 && holdersCount <= 3 && elapsedMonitoringMs >= 60 * 1e3) {
        dumpReason = 'less_mc_and_few_holders';
    }

    if (dumpReason) {
        const exitCode = 'DUMPED';

        if (buyPosition) {
            res = {
                exitCode: exitCode,
                message: `The token is probably dumped ${dumpReason} and we will sell at loss, sell=true`,
                shouldSell: {
                    reason: exitCode,
                },
            };
        } else {
            res = {
                exitCode: exitCode,
                message: `Stopped monitoring token because it was probably dumped ${dumpReason} and current market cap is less than the initial one`,
                shouldSell: false,
            };
        }
    } else if (!buyPosition && elapsedMonitoringMs >= maxWaitMs) {
        res = {
            exitCode: 'NO_PUMP',
            message: `Stopped monitoring token. We waited ${elapsedMonitoringMs / 1000} seconds and did not pump`,
            shouldSell: false,
        };
    }

    return res;
}
