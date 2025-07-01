import fs from 'fs';

import { silentLogger } from '@src/logger';
import { PumpfunBotConfig, PumpfunBotFileConfig } from '@src/trading/bots/blockchains/solana/types';
import { Schema } from '@src/trading/bots/types';
import { strategyFromConfig } from '@src/trading/strategies/launchpads/config-parser';

export function parsePumpfunBotFileConfig(path: string, reportSchema: Schema): PumpfunBotConfig {
    const config = JSON.parse(fs.readFileSync(path).toString()) as PumpfunBotFileConfig;

    return {
        runConfig: {
            reportSchema: reportSchema,
            ...config.runConfig,
        },
        strategyFactory: () => strategyFromConfig(config.strategy, silentLogger),
    };
}
