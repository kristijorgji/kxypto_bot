import { Logger } from 'winston';

import Wallet from '@src/blockchains/solana/Wallet';
import { lamportsToSol } from '@src/blockchains/utils/amount';

import PumpfunBotEventBus, { StopBotReason } from './PumpfunBotEventBus';

export default class PumpfunBotTradeManager {
    private openPositionsCount: number = 0;
    private askedStopListening: boolean = false;
    private fullTradesCount: number = 0;

    constructor(
        private readonly logger: Logger,
        private readonly botEventBus: PumpfunBotEventBus,
        private readonly wallet: Wallet,
        private readonly config: {
            maxOpenPositions: number | null;
            maxFullTrades: number | null;
            minWalletBalanceLamports: number | null;
        },
        private readonly listeners: {
            resumeListening: () => void;
        },
    ) {
        this.botEventBus.onTradeExecuted(async (botId, transaction) => {
            this.wallet.modifyBalance(transaction.netTransferredLamports);

            if (transaction.transactionType === 'buy') {
                this.openPositionsCount++;
            } else {
                this.openPositionsCount--;
            }

            if (this.config.maxOpenPositions && this.openPositionsCount >= this.config.maxOpenPositions) {
                this.askedStopListening = true;
                this.logger.info(
                    '[%s] - Max open positions %d reached, emitting stop bot',
                    PumpfunBotTradeManager.name,
                    this.config.maxOpenPositions,
                );
                this.botEventBus.stopBot(botId, 'max_open_positions');
            } else if (this.askedStopListening) {
                this.askedStopListening = false;
                this.listeners.resumeListening();
            }

            if (this.config.minWalletBalanceLamports) {
                const balanceLamports = await this.wallet.getBalanceLamports();
                if (balanceLamports <= this.config.minWalletBalanceLamports) {
                    this.logger.info(
                        '[%s] - Minimum wallet balance %s / %s reached, emitting stop bot',
                        PumpfunBotTradeManager.name,
                        lamportsToSol(balanceLamports),
                        lamportsToSol(this.config.minWalletBalanceLamports),
                    );
                    this.botEventBus.stopBot(botId, 'min_wallet_balance');
                }
            }
        });

        this.botEventBus.onBotTradeResponse(botId => {
            this.fullTradesCount++;
            if (this.config.maxFullTrades && this.fullTradesCount >= this.config.maxFullTrades) {
                this.logger.info(
                    '[%s] - Max full trades %d reached, emitting stop bot',
                    PumpfunBotTradeManager.name,
                    this.config.maxFullTrades,
                );
                this.botEventBus.stopBot(botId, 'max_full_trades');
            }
        });
    }

    stopAllBots(reason: StopBotReason): void {
        this.botEventBus.stopBot(null, reason);
    }
}
