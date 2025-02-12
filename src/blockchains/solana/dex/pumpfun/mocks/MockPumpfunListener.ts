import { randomInt } from 'crypto';

import { NewPumpFunTokenDataFactory } from '../../../../../testdata/factories';
import { sleep } from '../../../../../utils/functions';
import { NewPumpFunTokenData, PumpfunListener } from '../types';

export default class MockPumpfunListener implements PumpfunListener {
    private listeningToNewTokens = false;

    async listenForPumpFunTokens(onNewToken: (data: NewPumpFunTokenData) => void): Promise<void> {
        this.listeningToNewTokens = true;

        for (let i = 0; i < 1e6; i++) {
            if (!this.listeningToNewTokens) {
                return;
            }

            onNewToken(NewPumpFunTokenDataFactory());
            await sleep(randomInt(200, 700));
        }
    }

    stopListeningToNewTokens(): void {
        this.listeningToNewTokens = false;
    }
}
