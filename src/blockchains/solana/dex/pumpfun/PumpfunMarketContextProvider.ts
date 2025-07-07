import { measureExecutionTime } from '@src/apm/apm';
import { MarketContext } from '@src/trading/bots/launchpads/types';

import { PUMPFUN_TOKEN_SUPPLY } from './constants';
import Pumpfun from './Pumpfun';
import { PumpfunTokenBcStats } from './types';
import calculateHoldersStats from '../../../../trading/bots/launchpads/utils/calculateHoldersStats';
import SolanaAdapter from '../../SolanaAdapter';
import { TokenHolder } from '../../types';

export default class PumpfunMarketContextProvider {
    private readonly measureFn: typeof measureExecutionTime;

    constructor(
        private readonly pumpfun: Pumpfun,
        private readonly solanaAdapter: SolanaAdapter,
        private readonly config: {
            measureExecutionTime: boolean;
        },
    ) {
        this.measureFn = this.config.measureExecutionTime ? measureExecutionTime : <T>(fn: () => T) => fn();
    }

    async get({
        tokenMint,
        bondingCurve,
        creator,
    }: {
        tokenMint: string;
        bondingCurve: string;
        creator: string;
    }): Promise<MarketContext> {
        const [tokenHolders, { marketCapInSol, priceInSol, bondingCurveProgress }]: [
            TokenHolder[],
            PumpfunTokenBcStats,
        ] = await this.measureFn(
            () =>
                Promise.all([
                    this.measureFn(
                        () =>
                            this.solanaAdapter.getTokenHolders({
                                tokenMint: tokenMint,
                            }),
                        'solanaAdapter.getTokenHolders',
                    ),
                    this.measureFn(
                        () => this.pumpfun.getTokenBondingCurveStats(bondingCurve),
                        'pumpfun.getTokenBondingCurveStats',
                    ),
                ]),
            'getPumpTokenStats',
        );

        const holderStats = calculateHoldersStats({
            tokenHolders: tokenHolders,
            totalSupply: PUMPFUN_TOKEN_SUPPLY,
            creator: creator,
            bondingCurve: bondingCurve,
        });

        return {
            price: priceInSol,
            marketCap: marketCapInSol,
            bondingCurveProgress: bondingCurveProgress,
            holdersCount: holderStats.holdersCount,
            devHoldingPercentage: holderStats.devHoldingPercentage,
            topTenHoldingPercentage: holderStats.topTenHoldingPercentage,
            devHoldingPercentageCirculating: holderStats.devHoldingPercentageCirculating,
            topTenHoldingPercentageCirculating: holderStats.topTenHoldingPercentageCirculating,
            topHolderCirculatingPercentage: holderStats.topHolderCirculatingPercentage,
        };
    }
}
