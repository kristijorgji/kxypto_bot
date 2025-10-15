import { faker } from '@faker-js/faker';

import { ProtoBacktestMintFullResult } from '@src/protos/generated/backtests';
import { exitMonitoringReasonEnum } from '@src/trading/bots/types';
import { pickRandomItem } from '@src/utils/data/data';

export function ProtoBacktestMintFullResultFactory(): ProtoBacktestMintFullResult {
    const didExit = faker.datatype.boolean();

    return {
        id: faker.number.int(),
        backtest_id: faker.string.uuid(),
        config_variant: faker.animal.petName(),
        strategy_result_id: faker.number.int(),
        net_pnl: didExit ? undefined : faker.number.float(),
        holdings_value: faker.number.float(),
        roi: faker.number.float({ min: 0.1, max: 100 }),
        exit_code: didExit ? pickRandomItem(exitMonitoringReasonEnum.options) : undefined,
        exit_reason: didExit ? faker.person.firstName() : undefined,
        payload: {},
        created_at: faker.date.past().toString(),
    };
}
