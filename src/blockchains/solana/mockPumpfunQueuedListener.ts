import MockPumpfunListener from './dex/pumpfun/mocks/MockPumpfunListener';
import { NewPumpFunTokenData } from './dex/pumpfun/types';
import PumpfunQueuedListener from './dex/PumpfunQueuedListener';

export default function mockPumpfunQueuedListener(
    args: ConstructorParameters<typeof PumpfunQueuedListener>,
    beforeDispatchToken: (data: NewPumpFunTokenData) => void,
    config: {
        sleepTime: number | (() => number);
        maxTokens?: number | null;
        tokens?: NewPumpFunTokenData[] | null;
    },
): PumpfunQueuedListener {
    const mockName = 'MockPumpfunQueuedListener';
    const [logger, , maxConcurrent, processTokenFn] = args;
    let isListening = false;
    let forceStopped = false;
    let inProgress = 0;
    let taskIndex = 0;

    const mockPumpfunListener = new MockPumpfunListener(config);

    const mockQueueListener: PumpfunQueuedListener = {
        startListening: jest.fn(async () => {
            await mockPumpfunListener.listenForPumpFunTokens(async data => {
                if (forceStopped) {
                    logger.info('[%s] - Ignoring new token because forceStopped=true', mockName);
                    return;
                }

                if (maxConcurrent && inProgress >= maxConcurrent) {
                    logger.info('[%s] - Max tokens in progress %d, stopping listener...', mockName, maxConcurrent);
                    await mockQueueListener.stopListening(false);
                    return;
                }

                inProgress++;
                beforeDispatchToken(data);
                processTokenFn(taskIndex++, data).finally(() => {
                    inProgress--;
                    if (!forceStopped && !isListening && (maxConcurrent === null || inProgress < maxConcurrent)) {
                        mockQueueListener.startListening(false);
                    }
                });
            });
        }),
        stopListening: jest.fn((force: boolean) => {
            logger.info('[%s] - Stopped listening force=%s.', mockName, force);
            forceStopped = force;
            if (!isListening) {
                return;
            }
            isListening = false;
            mockPumpfunListener.stopListeningToNewTokens();
        }),
        isDone: jest.fn(() => {
            return !isListening && (forceStopped || mockPumpfunListener.getRemaining() === 0) && inProgress === 0;
        }),
    } as unknown as PumpfunQueuedListener;

    return mockQueueListener;
}
