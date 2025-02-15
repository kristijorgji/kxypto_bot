import axios from 'axios';

import { percentageToBps } from '../../../utils/amount';

interface JupiterQuoteConfig {
    inputMint: string;
    outputMint: string;
    inputAmount: number;
    slippageInPercent: number;
}

export async function getJupiterQuote({
    inputAmount,
    inputMint,
    outputMint,
    slippageInPercent,
}: JupiterQuoteConfig): Promise<unknown> {
    return await axios.get('https://quote-api.jup.ag/v6/quote', {
        params: {
            inputMint: inputMint,
            outputMint: outputMint,
            amount: inputAmount,
            slippageBps: percentageToBps(slippageInPercent),
        },
    });
}
