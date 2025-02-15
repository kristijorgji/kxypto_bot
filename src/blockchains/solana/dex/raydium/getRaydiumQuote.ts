import { API_URLS, TxVersion } from '@raydium-io/raydium-sdk-v2';
import axios from 'axios';

import { logger } from '../../../../logger';
import { percentageToBps } from '../../../utils/amount';

export type RaydiumQuoteResponse = {
    id: string;
    success: true;
    version: 'V0' | 'V1';
    openTime?: undefined;
    msg?: string;
    data?: {
        swapType: 'BaseIn' | 'BaseOut';
        inputMint: string;
        inputAmount: string;
        outputMint: string;
        outputAmount: string;
        otherAmountThreshold: string;
        slippageBps: number;
        priceImpactPct: number;
        routePlan: {
            poolId: string;
            inputMint: string;
            outputMint: string;
            feeMint: string;
            feeRate: number;
            feeAmount: string;
        }[];
    };
};

type RaydiumQuoteConfig = {
    inputMint: string;
    outputMint: string;
    inputAmount: number;
    slippageInPercent: number;
};

export async function getRaydiumQuote({
    inputMint,
    outputMint,
    inputAmount,
    slippageInPercent,
}: RaydiumQuoteConfig): Promise<RaydiumQuoteResponse> {
    logger.info(`Computing swap for input mint: ${inputMint}, outputMint: ${outputMint}, inputAmount: ${inputAmount}`);

    const response = await axios.get<RaydiumQuoteResponse>(`${API_URLS.SWAP_HOST}/compute/swap-base-in`, {
        params: {
            inputMint: inputMint,
            outputMint: outputMint,
            amount: inputAmount,
            slippageBps: percentageToBps(slippageInPercent),
            txVersion: TxVersion[TxVersion.V0],
        },
    });

    logger.info(`Compute Swap Response: ${JSON.stringify(response.data, null, 2)}`);
    return response.data;
}
