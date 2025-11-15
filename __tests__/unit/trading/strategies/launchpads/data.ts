import { LocalEnsemblePredictionSource, SinglePredictionSource } from '../../../../../src/trading/strategies/types';

export const sampleSinglePredictionSource: SinglePredictionSource = {
    algorithm: 'transformers',
    model: 'test_rsi7',
    endpoint: 'http://localhost/predict/buy/transformers/test_rsi7',
};

export const buyEnsemblePredictionSource: LocalEnsemblePredictionSource = {
    algorithm: 'ensemble',
    aggregationMode: 'weighted',
    sources: [
        {
            algorithm: 'catboost',
            model: 'v100',
            endpoint: 'http://localhost:3878/buy/cat/v100',
            weight: 0.77,
        },
        {
            algorithm: 'transformers',
            model: 'supra_transformers_v7',
            endpoint: 'http://localhost:3878/buy/transformers/v7',
            weight: 0.23,
        },
    ],
};

export const sellEnsemblePredictionSource: LocalEnsemblePredictionSource = {
    algorithm: 'ensemble',
    aggregationMode: 'weighted',
    sources: [
        {
            algorithm: 'catboost',
            model: '7',
            endpoint: 'http://localhost:3878/sell/cat/7',
            weight: 0.4,
        },
        {
            algorithm: 'transformers',
            model: 'supra_transformers_v7',
            endpoint: 'http://localhost:3878/sell/transformers/v7',
            weight: 0.6,
        },
    ],
};
