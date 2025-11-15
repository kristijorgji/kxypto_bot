import axios from 'axios';
import axiosRateLimit, { RateLimitedAxiosInstance } from 'axios-rate-limit';
import Redis from 'ioredis';
import { Logger } from 'winston';

import { HistoryEntry, MarketContext } from '@src/trading/bots/launchpads/types';
import { HistoryRef } from '@src/trading/bots/types';
import {
    FormPredictionRequestFailReason,
    MakePredictionRequestResponse,
    formBaseCacheKey,
    formPredictionRequest,
    makePredictionRequest,
} from '@src/trading/strategies/launchpads/prediction-common';
import {
    PredictionConfig,
    PredictionRequest,
    PredictionSource,
    Predictor,
    isSingleSource,
} from '@src/trading/strategies/types';

export type PredictorNotStartReason = {
    stopReason: 'requiredFeaturesLength' | FormPredictionRequestFailReason;
};

const CacheDefaultTtlSeconds = 3600 * 24 * 30;

export type DownsidePredictorResponse = MakePredictionRequestResponse | PredictorNotStartReason;

export default class DownsidePredictor implements Predictor<DownsidePredictorResponse> {
    private readonly client: RateLimitedAxiosInstance;

    private readonly cacheBaseKey: string | string[];

    constructor(
        private readonly logger: Logger,
        private readonly cache: Redis,
        private readonly source: PredictionSource,
        private readonly config: {
            prediction: PredictionConfig;
        },
    ) {
        this.client = axiosRateLimit(
            axios.create({
                validateStatus: () => true,
            }),
            { maxRequests: 16000, perMilliseconds: 1000 },
        );

        if (isSingleSource(this.source)) {
            this.cacheBaseKey = formBaseCacheKey('sell', this.config.prediction, this.source);
        } else {
            this.cacheBaseKey = this.source.sources.map(el => formBaseCacheKey('sell', this.config.prediction, el));
        }
    }

    async predict(
        mint: string,
        historyRef: HistoryRef,
        _context: MarketContext,
        history: HistoryEntry[],
    ): Promise<DownsidePredictorResponse> {
        if (history.length < this.config.prediction.requiredFeaturesLength) {
            return {
                stopReason: 'requiredFeaturesLength',
            };
        }

        const formPredictionRequestResult = formPredictionRequest(this.logger, this.config, mint, history);
        if ((formPredictionRequestResult as unknown as { reason: FormPredictionRequestFailReason }).reason) {
            return {
                stopReason: (formPredictionRequestResult as unknown as { reason: FormPredictionRequestFailReason })
                    .reason,
            };
        }

        const predictionRequest = formPredictionRequestResult as PredictionRequest;

        return await makePredictionRequest(
            this.client,
            this.cache,
            this.source,
            this.config,
            this.cacheBaseKey,
            mint,
            historyRef,
            predictionRequest,
            CacheDefaultTtlSeconds,
        );
    }
}
