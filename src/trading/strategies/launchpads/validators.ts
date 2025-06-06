import { StrategyPredictionConfig } from '../types';

export function validatePredictionConfig(config: Partial<StrategyPredictionConfig>): void {
    const messages: string[] = [];

    if (config.requiredFeaturesLength === undefined) {
        messages.push('requiredFeaturesLength is required');
    }

    if (config.skipAllSameFeatures === undefined) {
        messages.push('skipAllSameFeatures is required');
    }

    if (messages.length > 0) {
        throw new Error(messages.join(';'));
    }
}
