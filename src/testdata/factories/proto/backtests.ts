import { faker } from '@faker-js/faker';

import { ProcessingStatus } from '@src/db/types';
import { ProtoBacktestMintFullResult, ProtoBacktestStrategyFullResult } from '@src/protos/generated/backtests';
import { fakeMint } from '@src/testdata/factories/pumpfun';
import { exitMonitoringReasonEnum } from '@src/trading/bots/types';
import { pickRandomItem, randomInt } from '@src/utils/data/data';

export function ProtoBacktestStrategyFullResultFactory(): Omit<ProtoBacktestStrategyFullResult, 'created_at'> & {
    created_at: Date;
} {
    const strategy = faker.animal.petName();
    const totalTrades = faker.number.int();
    const wins = randomInt(1, totalTrades);
    const losses = totalTrades - wins;

    return {
        id: faker.number.int(),
        backtest_id: faker.string.uuid(),
        backtest_run_id: faker.number.int(),
        status: ProcessingStatus.Completed,
        strategy: faker.animal.petName(),
        strategy_id: `${strategy}_${faker.number.int()}`,
        config_variant: faker.animal.crocodilia(),
        config: {},
        pnl_sol: faker.number.float(),
        holdings_value_sol: faker.number.float(),
        roi: faker.number.float({ min: 0.1, max: 100 }),
        win_rate: faker.number.float(),
        wins_count: wins,
        biggest_win_percentage: faker.number.float(),
        losses_count: losses,
        biggest_loss_percentage: faker.number.float(),
        total_trades_count: totalTrades,
        buy_trades_count: totalTrades / 2,
        sell_trades_count: totalTrades / 2,
        highest_peak_sol: faker.number.float(),
        lowest_trough_sol: faker.number.float(),
        max_drawdown_percentage: faker.number.float(),
        execution_time_seconds: faker.number.int(),
        created_at: faker.date.past(),
    };
}

export function ProtoBacktestMintFullResultFactory(): Omit<ProtoBacktestMintFullResult, 'created_at'> & {
    created_at: Date;
} {
    const didExit = faker.datatype.boolean();

    return {
        id: faker.number.int(),
        strategy_result_id: faker.number.int(),
        mint: fakeMint(),
        net_pnl: didExit ? undefined : faker.number.float(),
        holdings_value: faker.number.float(),
        roi: faker.number.float({ min: 0.1, max: 100 }),
        exit_code: didExit ? pickRandomItem(exitMonitoringReasonEnum.options) : undefined,
        exit_reason: didExit ? faker.person.firstName() : undefined,
        payload: {},
        created_at: faker.date.past(),
    };
}
