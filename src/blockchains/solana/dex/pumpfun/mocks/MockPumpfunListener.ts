import { NewPumpFunTokenDataFactory } from '../../../../../testdata/factories/pumpfun';
import { sleep } from '../../../../../utils/functions';
import { NewPumpFunTokenData, PumpfunListener } from '../types';

export default class MockPumpfunListener implements PumpfunListener {
    private readonly sleepTime: number | (() => number);
    private readonly maxTokens: number;
    private readonly tokensToReturn: NewPumpFunTokenData[] | null;

    private listeningToNewTokens = false;
    private processedTokens = 0;

    constructor(config: {
        sleepTime: number | (() => number);
        maxTokens?: number | null;
        tokens?: NewPumpFunTokenData[] | null;
    }) {
        this.maxTokens = config.tokens ? config.tokens.length : (config.maxTokens ?? 1e6);
        this.sleepTime = config.sleepTime;
        this.tokensToReturn = config.tokens ?? null;
    }

    async listenForPumpFunTokens(onNewToken: (data: NewPumpFunTokenData) => Promise<void>): Promise<void> {
        this.listeningToNewTokens = true;

        while (this.processedTokens < this.maxTokens) {
            if (!this.listeningToNewTokens) {
                return;
            }

            onNewToken(
                this.tokensToReturn ? this.tokensToReturn[this.processedTokens] : NewPumpFunTokenDataFactory(),
            ).finally(() => {
                this.processedTokens++;
            });
            await sleep(typeof this.sleepTime === 'function' ? this.sleepTime() : this.sleepTime);
        }
    }

    stopListeningToNewTokens(): void {
        this.listeningToNewTokens = false;
    }

    getRemaining(): number {
        return this.maxTokens - this.processedTokens;
    }
}
