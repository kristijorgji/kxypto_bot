// eslint-disable-next-line import/no-extraneous-dependencies,import/no-named-as-default
import WS from 'jest-websocket-mock';

import Pumpfun from '../../../../../../src/blockchains/solana/dex/pumpfun/Pumpfun';
import CustomMockWebSocket from '../../../../../__mocks__/ws';
import { rawFixture } from '../../../../../__utils/data';

describe(Pumpfun.name, () => {
    let pumpfun: Pumpfun;
    let server: WS;

    beforeEach(async () => {
        server = new WS(process.env.SOLANA_WSS_ENDPOINT as string);
    });

    afterEach(() => {
        WS.clean();
        jest.clearAllMocks();
    });

    it('should monitor new tokens and notify with correctly parsed token data', async () => {
        const onNewTokenFn = jest.fn();

        pumpfun = new Pumpfun({
            rpcEndpoint: process.env.SOLANA_RPC_ENDPOINT as string,
            wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
        });

        await pumpfun.listenForPumpFunTokens(onNewTokenFn);
        await server.connected;

        server.send(rawFixture('dex/pumpfun/wss-on-message-logsSubscribe-logsNotification-create-0.json'));
        server.send(rawFixture('dex/pumpfun/wss-on-message-logsSubscribe-logsNotification-create-1.json'));

        expect(CustomMockWebSocket.sendMockFn).toHaveBeenCalledTimes(1);
        expect(CustomMockWebSocket.sendMockFn.mock.calls[0]).toEqual([
            '{"jsonrpc":"2.0","id":1,"method":"logsSubscribe","params":[{"mentions":["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"]},{"commitment":"processed"}]}',
        ]);

        expect(onNewTokenFn).toHaveBeenCalledTimes(2);
        expect(onNewTokenFn.mock.calls[0]).toEqual([
            {
                bondingCurve: '62pDpy9wCn4dyk2Y32mkGSPVzYUsNE6Dyb2GvAq5RXdk',
                mint: '9pSA9tgqgV8AUq7EFEXjHCrr7q6zmf9pxHkpbMDypump',
                name: 'Grammarlzy AI',
                symbol: 'Grammarly',
                uri: 'https://ipfs.io/ipfs/QmPULbJjjzEesD7Tc56H5j5sYGHG6d5uRzKjsZqHS9ud81',
                user: '931KZ79266ZsQVfbfvseWwQvCGLSVEDbyhXTKaQdGh9X',
            },
        ]);
        expect(onNewTokenFn.mock.calls[1]).toEqual([
            {
                name: 'Customer Dog',
                symbol: 'CDOG',
                uri: 'https://ipfs.io/ipfs/QmQ8YtukoR1K1WR5N3x5bNARkHdZ2EYbqcYkQ9aXogKeRr',
                mint: '2iZNDJ5Rwct7nThrtSAkJeEut5LxMrjZd6MRf3dWpump',
                bondingCurve: 'AHFj2ZfBd5Z1cRTk3oYXAgXFyDZ9kGHVCpHEBdvyEGKV',
                user: '6hPPEBvDgpWiwPRzB3jN7C7YVnHxZG1d3XE4reVaXA3k',
            },
        ]);
    });
});
