import { Logger } from 'winston';

import PumpfunBotEventBus from './PumpfunBotEventBus';
import Wallet from '../../../../blockchains/solana/Wallet';
import { lamportsToSol } from '../../../../blockchains/utils/amount';

export default class PumpfunBotsTradeManager {
    private fullTradesCount: number = 0;

    constructor(
        private readonly logger: Logger,
        private readonly botEventBus: PumpfunBotEventBus,
        private readonly wallet: Wallet,
        private readonly config: {
            maxFullTrades: number | null;
            minWalletBalanceLamports: number | null;
        },
    ) {
        this.botEventBus.onTradeExecuted(async transaction => {
            this.wallet.modifyBalance(transaction.netTransferredLamports);

            if (this.config.minWalletBalanceLamports) {
                const balanceLamports = await this.wallet.getBalanceLamports();
                if (balanceLamports <= this.config.minWalletBalanceLamports) {
                    this.logger.info(
                        '[%s] - Minimum wallet balance %s / %s reached, emitting stop bot',
                        PumpfunBotsTradeManager.name,
                        lamportsToSol(balanceLamports),
                        lamportsToSol(this.config.minWalletBalanceLamports),
                    );
                    this.botEventBus.stopBot();
                }
            }
        });

        this.botEventBus.onBotTradeResponse(() => {
            this.fullTradesCount++;
            if (this.config.maxFullTrades && this.fullTradesCount >= this.config.maxFullTrades) {
                this.logger.info(
                    '[%s] - Max full trades %d reached, emitting stop bot',
                    PumpfunBotsTradeManager.name,
                    this.config.maxFullTrades,
                );
                this.botEventBus.stopBot();
            }
        });
    }
}
