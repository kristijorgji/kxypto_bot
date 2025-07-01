import { Logger } from 'winston';

import { PumpfunListener } from '../../../../../../src/blockchains/solana/dex/pumpfun/types';
import PumpfunQueuedListener from '../../../../../../src/blockchains/solana/dex/PumpfunQueuedListener';
import { NewPumpFunTokenDataFactory } from '../../../../../../src/testdata/factories/pumpfun';
import { waitForVariable } from '../../../../../__utils/jest';

describe(PumpfunQueuedListener.name, () => {
    let logger: Logger;
    let pumpfunListener: jest.Mocked<PumpfunListener>;
    let processTokenMock: jest.Mock;
    let pumpfunQueuedListener: PumpfunQueuedListener;

    beforeEach(() => {
        logger = {
            info: jest.fn(),
            error: jest.fn(),
        } as unknown as Logger;
        pumpfunListener = {
            listenForPumpFunTokens: jest.fn(),
            stopListeningToNewTokens: jest.fn(),
        };
        processTokenMock = jest.fn().mockResolvedValue(undefined);
        pumpfunQueuedListener = new PumpfunQueuedListener(logger, pumpfunListener, 3, processTokenMock);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should start listening when startListening is called', async () => {
        const newTokenData = NewPumpFunTokenDataFactory();

        (pumpfunListener.listenForPumpFunTokens as jest.Mock).mockImplementation((callback: Function) => {
            callback(newTokenData);
        });

        await pumpfunQueuedListener.startListening(false);

        expect(pumpfunListener.listenForPumpFunTokens).toHaveBeenCalled();
        expect(processTokenMock).toHaveBeenCalledWith(0, newTokenData);
        expect(logger.info).toHaveBeenCalledWith('[%s] - Listening for new tokens...', 'PumpfunQueuedListener');
    });

    it('should stop listening when max concurrent tokens are reached and resume on the next one', async () => {
        let times = 0;
        (pumpfunListener.listenForPumpFunTokens as jest.Mock).mockImplementation((callback: Function) => {
            if (times++ === 0) {
                callback(NewPumpFunTokenDataFactory());
                callback(NewPumpFunTokenDataFactory());
                callback(NewPumpFunTokenDataFactory());
                callback(NewPumpFunTokenDataFactory());
            }
        });

        await pumpfunQueuedListener.startListening(false);

        expect(logger.info).toHaveBeenNthCalledWith(
            3,
            '[%s] - Max tokens in progress %d, stopping listener...',
            'PumpfunQueuedListener',
            3,
        );
        expect(pumpfunListener.listenForPumpFunTokens).toHaveBeenCalledTimes(2);
        expect(pumpfunListener.stopListeningToNewTokens).toHaveBeenCalledTimes(1);
    });

    it('should decrement inProgress when processToken is finished', async () => {
        processTokenMock.mockResolvedValueOnce(new Promise<void>(resolve => setTimeout(() => resolve(), 10)));

        // Simulate the listener receiving new tokens
        (pumpfunListener.listenForPumpFunTokens as jest.Mock).mockImplementation((callback: Function) => {
            callback(NewPumpFunTokenDataFactory());
        });

        await pumpfunQueuedListener.startListening(false);

        expect(pumpfunQueuedListener.getInProgressCount()).toBe(1);
        await waitForVariable(() => pumpfunQueuedListener.getInProgressCount(), 0, 100);
    });
});
