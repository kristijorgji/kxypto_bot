import { sleep } from '@raydium-io/raydium-sdk-v2';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Connection, PublicKey } from '@solana/web3.js';
import WS from 'jest-websocket-mock';

import { startActionBondingCurveState } from './data';
import { getTokenBondingCurveState } from '../../../../../../src/blockchains/solana/dex/pumpfun/pump-bonding-curve';
import PumpfunListener from '../../../../../../src/blockchains/solana/dex/pumpfun/PumpfunListener';
import { NewPumpFunTokenData } from '../../../../../../src/blockchains/solana/dex/pumpfun/types';
import CustomMockWebSocket from '../../../../../__mocks__/ws';
import { rawFixture } from '../../../../../__utils/data';

jest.mock('@solana/web3.js', () => {
    const actualWeb3 = jest.requireActual('@solana/web3.js');

    return {
        ...actualWeb3,
        Connection: jest.fn().mockImplementation(() => ({
            getAccountInfo: jest.fn(),
            getParsedTransaction: jest.fn(),
        })),
    };
});

jest.mock('../../../../../../src/blockchains/solana/dex/pumpfun/pump-bonding-curve', () => ({
    ...jest.requireActual('../../../../../../src/blockchains/solana/dex/pumpfun/pump-bonding-curve'),
    getTokenBondingCurveState: jest.fn(),
}));

describe(PumpfunListener.name, () => {
    let pumpfun: PumpfunListener;
    let server: WS;

    beforeEach(async () => {
        server = new WS(process.env.SOLANA_WSS_ENDPOINT as string);
        pumpfun = new PumpfunListener(
            {
                wsEndpoint: process.env.SOLANA_WSS_ENDPOINT as string,
            },
            new Connection(process.env.SOLANA_RPC_ENDPOINT as string, 'confirmed'),
        );

        (getTokenBondingCurveState as jest.Mock).mockResolvedValue(startActionBondingCurveState);
    });

    afterEach(() => {
        WS.clean();
        jest.clearAllMocks();
        pumpfun && pumpfun.stopListeningToNewTokens();
    });

    it('should monitor new tokens and notify with correctly parsed token data', async () => {
        const onNewTokenFn = jest.fn();

        await pumpfun.listenForPumpFunTokens(onNewTokenFn);
        await server.connected;

        (pumpfun.connection.getAccountInfo as jest.Mock).mockResolvedValue({
            owner: new PublicKey(TOKEN_PROGRAM_ID),
        });

        server.send(rawFixture('dex/pumpfun/wss-on-message-logsSubscribe-logsNotification-create-0.json'));
        server.send(rawFixture('dex/pumpfun/wss-on-message-logsSubscribe-logsNotification-create-1.json'));

        expect(CustomMockWebSocket.sendMockFn).toHaveBeenCalledTimes(1);
        expect(CustomMockWebSocket.sendMockFn.mock.calls[0]).toEqual([
            '{"jsonrpc":"2.0","id":1,"method":"logsSubscribe","params":[{"mentions":["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"]},{"commitment":"processed"}]}',
        ]);

        expect(pumpfun.connection.getAccountInfo as jest.Mock).toHaveBeenCalledTimes(2);
        expect(pumpfun.connection.getAccountInfo as jest.Mock).toHaveBeenNthCalledWith(
            1,
            new PublicKey('9pSA9tgqgV8AUq7EFEXjHCrr7q6zmf9pxHkpbMDypump'),
        );
        expect(pumpfun.connection.getAccountInfo as jest.Mock).toHaveBeenNthCalledWith(
            2,
            new PublicKey('2iZNDJ5Rwct7nThrtSAkJeEut5LxMrjZd6MRf3dWpump'),
        );

        await sleep(50);

        expect(onNewTokenFn).toHaveBeenCalledTimes(2);
        expect(onNewTokenFn.mock.calls).toEqual([
            [
                {
                    bondingCurve: '62pDpy9wCn4dyk2Y32mkGSPVzYUsNE6Dyb2GvAq5RXdk',
                    mint: '9pSA9tgqgV8AUq7EFEXjHCrr7q6zmf9pxHkpbMDypump',
                    tokenProgramId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                    name: 'Grammarlzy AI',
                    symbol: 'Grammarly',
                    uri: 'https://ipfs.io/ipfs/QmPULbJjjzEesD7Tc56H5j5sYGHG6d5uRzKjsZqHS9ud81',
                    user: '931KZ79266ZsQVfbfvseWwQvCGLSVEDbyhXTKaQdGh9X',
                } satisfies NewPumpFunTokenData,
            ],
            [
                {
                    mint: '2iZNDJ5Rwct7nThrtSAkJeEut5LxMrjZd6MRf3dWpump',
                    tokenProgramId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                    name: 'Customer Dog',
                    symbol: 'CDOG',
                    uri: 'https://ipfs.io/ipfs/QmQ8YtukoR1K1WR5N3x5bNARkHdZ2EYbqcYkQ9aXogKeRr',
                    bondingCurve: 'AHFj2ZfBd5Z1cRTk3oYXAgXFyDZ9kGHVCpHEBdvyEGKV',
                    user: '6hPPEBvDgpWiwPRzB3jN7C7YVnHxZG1d3XE4reVaXA3k',
                } satisfies NewPumpFunTokenData,
            ],
        ]);
    });
});
