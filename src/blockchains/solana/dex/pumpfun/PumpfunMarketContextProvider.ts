import { PUMPFUN_TOKEN_SUPPLY } from './constants';
import Pumpfun from './Pumpfun';
import { PumpfunTokenBcStats } from './types';
import { measureExecutionTime } from '../../../../apm/apm';
import { MarketContext } from '../../../../trading/bots/launchpads/types';
import calculateHoldersStats from '../../../../trading/bots/launchpads/utils/calculateHoldersStats';
import SolanaAdapter from '../../SolanaAdapter';
import { TokenHolder } from '../../types';

export default class PumpfunMarketContextProvider {
    // eslint-disable-next-line no-useless-constructor
    constructor(private readonly pumpfun: Pumpfun, private readonly solanaAdapter: SolanaAdapter) {}

    async get({
        tokenMint,
        bondingCurve,
        creator,
    }: {
        tokenMint: string;
        bondingCurve: string;
        creator: string;
    }): Promise<MarketContext> {
        // @ts-ignore
        const [tokenHolders, { marketCapInSol, priceInSol, bondingCurveProgress }]: [
            TokenHolder[],
            PumpfunTokenBcStats,
        ] = await measureExecutionTime(
            () =>
                Promise.all([
                    measureExecutionTime(
                        () =>
                            this.solanaAdapter.getTokenHolders({
                                tokenMint: tokenMint,
                            }),
                        'solanaAdapter.getTokenHolders',
                    ),
                    measureExecutionTime(
                        () => this.pumpfun.getTokenBondingCurveStats(bondingCurve),
                        'pumpfun.getTokenBondingCurveStats',
                    ),
                ]),
            'getPumpTokenStats',
        );

        const { holdersCount, devHoldingPercentage, topTenHoldingPercentage } = calculateHoldersStats({
            tokenHolders: tokenHolders,
            totalSupply: PUMPFUN_TOKEN_SUPPLY,
            creator: creator,
            bondingCurve: bondingCurve,
        });

        return {
            price: priceInSol,
            marketCap: marketCapInSol,
            bondingCurveProgress: bondingCurveProgress,
            holdersCount: holdersCount,
            devHoldingPercentage: devHoldingPercentage,
            topTenHoldingPercentage: topTenHoldingPercentage,
        };
    }
}
