import { faker } from '@faker-js/faker';

import { Backtest, BacktestStrategyResult, ProcessingStatus } from '@src/db/types';
import { withDefault } from '@src/testdata/utils';
import { BacktestConfig } from '@src/trading/bots/blockchains/solana/types';
import { pickRandomItem } from '@src/utils/data/data';
import { getRandomEnumValue } from '@src/utils/data/enum';

const strategyNames = ['MomentumAI', 'PumpHunter', 'DipSniper', 'MeanRev', 'BreakoutX'];
const configVariants = ['v1', 'v2', 'aggressive', 'safe'];

export function BacktestFactory(copy?: Partial<Backtest>): Backtest {
    return {
        id: copy?.id ?? faker.string.uuid(),
        chain: 'solana',
        name:
            copy?.name ??
            faker.string.alpha({
                length: 20,
            }),
        config:
            copy?.config ??
            ({
                initialBalanceLamports: 1e9,
                data: {
                    path: faker.system.directoryPath(),
                    filesCount: faker.number.int({ min: 0 }),
                },
            } as BacktestConfig),
        created_at: withDefault(copy, 'created_at', faker.date.past()),
    };
}

export function BacktestStrategyResultFactory(copy?: Partial<BacktestStrategyResult>): BacktestStrategyResult {
    const status: ProcessingStatus = copy?.status ?? getRandomEnumValue(ProcessingStatus);
    const pnl = copy?.pnl_sol ?? Math.round((Math.random() - 0.4) * 1000);
    const roi = copy?.roi ?? faker.number.float({ min: 0.0, max: 100 });

    const createdAt = copy?.created_at ?? new Date(Date.now() - Math.random() * 1e7);
    const updatedAt = copy?.updated_at ?? new Date(Date.now() - Math.random() * 1e7);

    const totalTradesCount = copy?.total_trades_count ?? faker.number.int({ min: 1 }) * 2;
    const buyTradesCount = totalTradesCount / 2;
    const sellTradesCount = totalTradesCount / 2;
    const winRate = copy?.win_rate ?? faker.number.int({ min: 0.0, max: 100 });
    const winsCount = copy?.wins_count ?? Math.round((winRate * (totalTradesCount / 2)) / 100);
    const lossesCount = copy?.losses_count ?? totalTradesCount / 2 - winsCount;

    return {
        id: copy?.id ?? faker.number.int(),
        backtest_id: copy?.backtest_id ?? faker.string.uuid(),
        backtest_run_id: copy?.backtest_run_id ?? faker.number.int(),
        status: status,
        strategy: copy?.strategy ?? pickRandomItem(strategyNames),
        strategy_id: copy?.strategy_id ?? faker.string.uuid(),
        config_variant: copy?.config_variant ?? pickRandomItem(configVariants),
        config: copy?.config ?? {},
        pnl_sol: pnl,
        holdings_value_sol: copy?.holdings_value_sol ?? faker.number.float(),
        roi: roi,
        win_rate: winRate,
        wins_count: winsCount,
        biggest_win_percentage: copy?.biggest_win_percentage ?? faker.number.float({ min: 0.0, max: 20 }),
        losses_count: lossesCount,
        biggest_loss_percentage: copy?.biggest_loss_percentage ?? faker.number.float({ min: 0.0, max: 20 }),
        total_trades_count: totalTradesCount,
        buy_trades_count: buyTradesCount,
        sell_trades_count: sellTradesCount,
        highest_peak_sol: copy?.highest_peak_sol ?? faker.number.float(),
        lowest_trough_sol: copy?.lowest_trough_sol ?? faker.number.float(),
        max_drawdown_percentage: copy?.max_drawdown_percentage ?? faker.number.float({ min: 0 }),
        execution_time_seconds: copy?.execution_time_seconds ?? Math.round(Math.random() * 3600),
        created_at: createdAt,
        updated_at: updatedAt,
    };
}
