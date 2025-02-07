import { API_URLS } from '@raydium-io/raydium-sdk-v2';
import axios from 'axios';

import { logger } from '../../../../logger';

type PriorityFeeLevel = {
    veryHigh: number;
    high: number;
    medium: number;
};

type PriorityFeeResponse = {
    id: string;
    success: boolean;
    data: {
        default: {
            vh: number;
            h: number;
            m: number;
        };
    };
};

export type PriorityFeeConfig = {
    max: number;
    optimizePriorityFee?: boolean;
};

async function fetchPriorityFees(): Promise<PriorityFeeLevel> {
    const { data } = await axios.get<PriorityFeeResponse>(`${API_URLS.BASE_HOST}${API_URLS.PRIORITY_FEE}`);
    const { vh: veryHigh, h: high, m: medium } = data.data.default;

    return { veryHigh, high, medium };
}

function calculateOptimalFee(maxFee: number, fees: PriorityFeeLevel): number {
    if (fees.veryHigh <= maxFee) {
        return fees.veryHigh;
    }
    if (fees.high <= maxFee) {
        return fees.high;
    }
    if (fees.medium <= maxFee) {
        return fees.medium;
    }
    return Math.min(maxFee, fees.high);
}

export async function calculatePriorityFee({ max, optimizePriorityFee = true }: PriorityFeeConfig): Promise<number> {
    logger.info(`Calculating priority fee, max: ${max}, optimize ${optimizePriorityFee}`);

    if (!optimizePriorityFee) {
        return Promise.resolve(max);
    }

    const priorityFee = calculateOptimalFee(max, await fetchPriorityFees());

    logger.info(`Priority fee: ${priorityFee}`);
    return priorityFee;
}
