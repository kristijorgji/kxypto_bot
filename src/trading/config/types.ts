import { z } from 'zod';

import { buyPredictionStrategyConfigSchema } from '@src/trading/strategies/launchpads/BuyPredictionStrategy';
import { buySellPredictionStrategyConfigSchema } from '@src/trading/strategies/launchpads/BuySellPredictionStrategy';
import { pricePredictionStrategyConfigSchema } from '@src/trading/strategies/launchpads/PricePredictionStrategy';
import { riseStrategyConfigSchema } from '@src/trading/strategies/launchpads/RiseStrategy';
import { stupidSniperStrategyConfigSchema } from '@src/trading/strategies/launchpads/StupidSniperStrategy';
import { predictionSourceSchema } from '@src/trading/strategies/types';
import { partialExcept } from '@src/utils/zod/partialExcept';

export const loggerTypeSchema = z.enum(['silent', 'normal']);

const stupidSniperStrategySchema = z.object({
    type: z.literal('StupidSniperStrategy'),
    config: stupidSniperStrategyConfigSchema.partial(),
});

const riseStrategySchema = z.object({
    type: z.literal('RiseStrategy'),
    config: riseStrategyConfigSchema.partial(),
});

const buyPredictionStrategySchema = z.object({
    type: z.literal('BuyPredictionStrategy'),
    config: partialExcept(buyPredictionStrategyConfigSchema, ['predictionSource']),
});

const buySellPredictionStrategySchema = z.object({
    type: z.literal('BuySellPredictionStrategy'),
    config: partialExcept(buySellPredictionStrategyConfigSchema, ['prediction']),
});

const pricePredictionStrategySchema = z.object({
    type: z.literal('PricePredictionStrategy'),
    source: predictionSourceSchema,
    config: partialExcept(pricePredictionStrategyConfigSchema, ['predictionSource']),
});

const baseStrategySchema = z.object({
    logger: loggerTypeSchema.optional(),
});

export const strategyFileConfigSchema = baseStrategySchema.and(
    z.discriminatedUnion('type', [
        stupidSniperStrategySchema,
        riseStrategySchema,
        buyPredictionStrategySchema,
        buySellPredictionStrategySchema,
        pricePredictionStrategySchema,
    ]),
);
export type StrategyFileConfig = z.infer<typeof strategyFileConfigSchema>;
