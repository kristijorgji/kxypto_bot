import bs58 from 'bs58';
import WebSocket, { MessageEvent } from 'ws';

import { PUMP_FUN_PROGRAM } from './constants';
import { NewPumpFunTokenData } from './types';
import { logger } from '../../../../logger';
import { WssMessage } from '../../types';

/**
 * @see https://github.dev/bilix-software/solana-pump-fun
 */
export default class Pumpfun {
    // eslint-disable-next-line no-useless-constructor
    constructor(private readonly config: { solanaWebsocketUrl: string }) {}

    async listenForPumpFunTokens(onNewToken: (data: NewPumpFunTokenData) => void) {
        try {
            const ws = new WebSocket(this.config.solanaWebsocketUrl);

            ws.on('open', () => {
                const subscriptionMessage = JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'logsSubscribe',
                    params: [{ mentions: [PUMP_FUN_PROGRAM] }, { commitment: 'processed' }],
                });
                ws.send(subscriptionMessage);
                logger.info(`Listening for new token creations from program: ${PUMP_FUN_PROGRAM}`);
            });

            ws.on('message', message => {
                const data = (message as unknown as MessageEvent).type
                    ? JSON.parse(<string>(message as unknown as MessageEvent).data)
                    : (JSON.parse(message.toString()) as WssMessage);

                if (data.method !== 'logsNotification') {
                    return;
                }

                const logData = data.params.result.value;
                const logs = logData.logs || [];

                if (logs.some((log: string) => log.includes('Program log: Instruction: Create'))) {
                    for (const log of logs) {
                        if (log.startsWith('Program data:')) {
                            try {
                                const encodedData = log.split(': ')[1];
                                const decodedData = Buffer.from(encodedData, 'base64');
                                const parsedData = parseCreateInstruction(decodedData);

                                if (parsedData && parsedData.name) {
                                    onNewToken(parsedData);
                                }
                            } catch (error) {
                                logger.error(`Failed to decode: ${log}`);
                                logger.error(`Error: ${error}`);
                            }
                        }
                    }
                }
            });

            ws.on('error', error => {
                logger.error(`WebSocket error: ${error}`);
            });

            ws.on('close', async () => {
                logger.debug('Connection closed. Reconnecting in 5 seconds...');
                await setTimeout(() => {
                    this.listenForPumpFunTokens(onNewToken);
                }, 5000);
            });
        } catch (error) {
            logger.error(`Connection error: ${error}`);
            logger.debug('Reconnecting in 5 seconds...');
            await setTimeout(() => {
                this.listenForPumpFunTokens(onNewToken);
            }, 5000);
        }
    }
}

function parseCreateInstruction(data: Buffer): NewPumpFunTokenData | null {
    if (data.length < 8) {
        return null;
    }

    let offset = 8;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsedData: Record<string, any> = {};

    const fields: [string, 'string' | 'publicKey'][] = [
        ['name', 'string'],
        ['symbol', 'string'],
        ['uri', 'string'],
        ['mint', 'publicKey'],
        ['bondingCurve', 'publicKey'],
        ['user', 'publicKey'],
    ];

    try {
        for (const [fieldName, fieldType] of fields) {
            if (fieldType === 'string') {
                const length = data.readUInt32LE(offset);
                offset += 4;
                parsedData[fieldName] = data.subarray(offset, offset + length).toString('utf-8');
                offset += length;
            } else if (fieldType === 'publicKey') {
                parsedData[fieldName] = bs58.encode(data.subarray(offset, offset + 32));
                offset += 32;
            }
        }

        return parsedData as NewPumpFunTokenData;
    } catch {
        return null;
    }
}
