import { clearTimeout } from 'node:timers';

import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Connection, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import WebSocket, { MessageEvent } from 'ws';

import { PUMP_FUN_PROGRAM } from '@src/blockchains/solana/dex/pumpfun/constants';
import { NewPumpFunTokenData, PumpfunListenerInterface } from '@src/blockchains/solana/dex/pumpfun/types';
import { WssMessage } from '@src/blockchains/solana/types';
import { logger } from '@src/logger';

export default class PumpfunListener implements PumpfunListenerInterface {
    private listeningToNewTokens = false;
    private ws: WebSocket | undefined;
    private relistenTimeout: ReturnType<typeof setTimeout> | undefined;

    constructor(
        private readonly config: { wsEndpoint: string },
        readonly connection: Connection,
    ) {}

    async listenForPumpFunTokens(onNewToken: (data: NewPumpFunTokenData) => void): Promise<void> {
        this.listeningToNewTokens = true;

        try {
            this.ws = new WebSocket(this.config.wsEndpoint);

            this.ws!.on('open', () => {
                const subscriptionMessage = JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'logsSubscribe',
                    params: [{ mentions: [PUMP_FUN_PROGRAM] }, { commitment: 'processed' }],
                });
                this.ws!.send(subscriptionMessage);
                logger.info(`Listening for new token creations from program: ${PUMP_FUN_PROGRAM}`);
            });

            this.ws!.on('message', async message => {
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
                                if (parsedData && !parsedData.tokenProgramId) {
                                    const mintInfo = await this.connection.getAccountInfo(
                                        new PublicKey(parsedData.mint),
                                    );
                                    if (mintInfo) {
                                        if (mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
                                            parsedData.tokenProgramId = TOKEN_2022_PROGRAM_ID.toBase58();
                                        } else if (mintInfo.owner.equals(TOKEN_PROGRAM_ID)) {
                                            parsedData.tokenProgramId = TOKEN_PROGRAM_ID.toBase58();
                                        }
                                    }
                                }

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

            this.ws!.on('error', error => {
                logger.error(`WebSocket error: ${error}`);
            });

            this.ws!.on('close', async (code, reason) => {
                if (this.listeningToNewTokens) {
                    logger.debug(`Connection closed, code ${code}, reason ${reason}. Reconnecting in 5 seconds...`);
                    this.relistenTimeout = setTimeout(() => {
                        this.listenForPumpFunTokens(onNewToken);
                    }, 5000);
                } else {
                    logger.info('Will not retry connecting because we set listeningToNewTokens=false');
                }
            });
        } catch (error) {
            logger.error(`Connection error: ${error}`);

            if (this.listeningToNewTokens) {
                logger.debug('Reconnecting in 5 seconds...');
                this.relistenTimeout = setTimeout(() => {
                    this.listenForPumpFunTokens(onNewToken);
                }, 5000);
            } else {
                logger.info('Will not retry connecting because we set listeningToNewTokens=false');
            }
        }
    }

    stopListeningToNewTokens(): void {
        clearTimeout(this.relistenTimeout);
        this.listeningToNewTokens = false;
        if (this.ws) {
            this.ws?.removeAllListeners && this.ws?.removeAllListeners();
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws?.close();
            }
            this.ws = undefined;
        }
    }
}

function parseCreateInstruction(data: Buffer): NewPumpFunTokenData | null {
    if (data.length < 8) {
        return null;
    }

    // Extract the 8-byte discriminator
    const discriminator = data.subarray(0, 8);

    // Define the discriminators from the IDL
    const createLegacyDisc = Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]);
    const createV2Disc = Buffer.from([214, 144, 76, 236, 95, 139, 49, 180]);

    let tokenProgramId: string | undefined = undefined;
    if (discriminator.equals(createLegacyDisc)) {
        tokenProgramId = TOKEN_PROGRAM_ID.toBase58();
    } else if (discriminator.equals(createV2Disc)) {
        tokenProgramId = TOKEN_2022_PROGRAM_ID.toBase58();
    }

    let offset = 8;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsedData: Record<string, any> = {
        tokenProgramId: tokenProgramId,
    } satisfies Partial<NewPumpFunTokenData>;

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
