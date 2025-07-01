import { Logger } from 'winston';

import { NewPumpFunTokenData, PumpfunListener } from './pumpfun/types';

export default class PumpfunQueuedListener {
    private isListening = false;
    private forceStopped = false;
    private inProgress = 0;
    private taskIndex: number = 0;

    constructor(
        private readonly logger: Logger,
        private readonly pumpfun: PumpfunListener,
        private readonly maxConcurrent: number | null,
        private readonly processToken: (identifier: number, data: NewPumpFunTokenData) => Promise<void>,
    ) {}

    public getInProgressCount(): number {
        return this.inProgress;
    }

    async startListening(force: boolean) {
        this.logger.info('[%s] - startListening force=%s', PumpfunQueuedListener.name, force);
        if (!force && (this.isListening || this.forceStopped)) {
            this.logger.info('[%s] - Ignoring startListening, state=%o...', PumpfunQueuedListener.name, {
                isListening: this.isListening,
                forceStopped: this.forceStopped,
            });
            return;
        }
        this.isListening = true;
        if (force) {
            this.forceStopped = false;
        }
        this.logger.info('[%s] - Listening for new tokens...', PumpfunQueuedListener.name);

        await this.pumpfun.listenForPumpFunTokens(async data => {
            if (this.forceStopped) {
                this.logger.info('[%s] - Ignoring new token because forceStopped=true', PumpfunQueuedListener.name);
                return;
            }

            if (this.maxConcurrent && this.inProgress >= this.maxConcurrent) {
                this.logger.info(
                    '[%s] - Max tokens in progress %d, stopping listener...',
                    PumpfunQueuedListener.name,
                    this.maxConcurrent,
                );
                await this.stopListening(false);
                return;
            }

            this.inProgress++;

            this.processToken(this.taskIndex++, data).finally(() => {
                this.inProgress--;
                if (
                    !this.forceStopped &&
                    !this.isListening &&
                    (this.maxConcurrent === null || this.inProgress < this.maxConcurrent)
                ) {
                    this.startListening(false);
                }
            });
        });
    }

    async stopListening(force: boolean) {
        this.logger.info('[%s] - Stopped listening force=%s.', PumpfunQueuedListener.name, force);
        this.forceStopped = force;
        if (!this.isListening) {
            return;
        }
        this.isListening = false;
        this.pumpfun.stopListeningToNewTokens();
    }

    isDone(): boolean {
        return !this.isListening && this.forceStopped && this.inProgress === 0;
    }
}
