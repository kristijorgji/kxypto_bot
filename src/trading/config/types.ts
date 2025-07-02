import { z } from 'zod';

import { buyPredictionStrategyConfigSchema } from '@src/trading/strategies/launchpads/BuyPredictionStrategy';
import { pricePredictionStrategyConfigSchema } from '@src/trading/strategies/launchpads/PricePredictionStrategy';
import { riseStrategyConfigSchema } from '@src/trading/strategies/launchpads/RiseStrategy';
import { predictionSourceSchema } from '@src/trading/strategies/types';

export const loggerTypeSchema = z.enum(['silent', 'normal']);

const riseStrategySchema = z.object({
    type: z.literal('RiseStrategy'),
    config: riseStrategyConfigSchema.partial(),
});

const buyPredictionStrategySchema = z.object({
    type: z.literal('BuyPredictionStrategy'),
    source: predictionSourceSchema,
    config: buyPredictionStrategyConfigSchema.partial(),
});

const pricePredictionStrategySchema = z.object({
    type: z.literal('PricePredictionStrategy'),
    source: predictionSourceSchema,
    config: pricePredictionStrategyConfigSchema.partial(),
});

const baseStrategySchema = z.object({
    logger: loggerTypeSchema.optional(),
});

export const strategyFileConfigSchema = baseStrategySchema.and(
    z.union([riseStrategySchema, buyPredictionStrategySchema, pricePredictionStrategySchema]),
);
export type StrategyFileConfig = z.infer<typeof strategyFileConfigSchema>;
