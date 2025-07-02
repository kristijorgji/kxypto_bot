import fs from 'fs';

import { silentLogger } from '@src/logger';
import { PumpfunBotConfig, pumpfunBotFileConfigSchema } from '@src/trading/bots/blockchains/solana/types';
import { Schema } from '@src/trading/bots/types';
import { strategyFromConfig } from '@src/trading/strategies/launchpads/config-parser';

export function parsePumpfunBotFileConfig(path: string, reportSchema: Schema): PumpfunBotConfig {
    const config = pumpfunBotFileConfigSchema.parse(JSON.parse(fs.readFileSync(path).toString()));

    return {
        runConfig: {
            reportSchema: reportSchema,
            ...config.runConfig,
        },
        strategyFactory: () => strategyFromConfig(config.strategy, silentLogger),
    };
}
