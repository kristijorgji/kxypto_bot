import { RiseStrategyConfig } from '../../strategies/launchpads/RiseStrategy';

export type StartState = {
    holdersCount: [number, number];
    bondingCurveProgress: [number, number];
    devHoldingPercentage: [number, number];
    topTenHoldingPercentage: [number, number];
    trailingStopLossPercentage: [number, number];
    takeProfitPercentage: [number, number];
};

export type EndState = Record<keyof StartState, number>;

export default class RiseStrategyConfigGenerator {
    private _resumeState: EndState | undefined;

    // Function to calculate total combinations from ranges and resume from EndState
    calculateTotalCombinations(state: StartState, resumeState?: EndState): number {
        // If we have a resume state, we can modify the start values
        const ranges = Object.keys(state).map(key => {
            const range = state[key as keyof StartState];
            const min = range[0];
            const max = range[1];

            // If there's a resume state, start from the value stored in endState
            const resumeValue = resumeState ? resumeState[key as keyof EndState] : min;

            // Generate the range from the resume value to the max
            return Array.from({ length: max - resumeValue + 1 }, (_, i) => resumeValue + i);
        });

        // Calculate the total combinations
        return ranges.reduce((total, range) => total * range.length, 1);
    }

    *formStrategies(s: StartState, resumeState?: EndState): Generator<Partial<RiseStrategyConfig>> {
        const startHoldersCount = resumeState?.holdersCount ?? s.holdersCount[0];
        const startBcp = resumeState?.bondingCurveProgress ?? s.bondingCurveProgress[0];
        const startDhp = resumeState?.devHoldingPercentage ?? s.devHoldingPercentage[0];
        const startTthp = resumeState?.topTenHoldingPercentage ?? s.topTenHoldingPercentage[0];
        const startTslp = resumeState?.trailingStopLossPercentage ?? s.trailingStopLossPercentage[0];
        const startTpp = resumeState?.takeProfitPercentage ?? s.takeProfitPercentage[0];

        for (let holdersCount = startHoldersCount; holdersCount <= s.holdersCount[1]; holdersCount++) {
            for (let bcp = startBcp; bcp <= s.bondingCurveProgress[1]; bcp++) {
                for (let dhp = startDhp; dhp <= s.devHoldingPercentage[1]; dhp++) {
                    for (let tthp = startTthp; tthp <= s.topTenHoldingPercentage[1]; tthp++) {
                        for (
                            let trailingStopLossPercentage = startTslp;
                            trailingStopLossPercentage <= s.trailingStopLossPercentage[1];
                            trailingStopLossPercentage++
                        ) {
                            for (
                                let takeProfitPercentage = startTpp;
                                takeProfitPercentage <= s.takeProfitPercentage[1];
                                takeProfitPercentage++
                            ) {
                                yield {
                                    variant: `hc_${holdersCount}_bcp_${bcp}_dhp_${dhp}_tthp_${tthp}_tslp_${trailingStopLossPercentage}_tpp_${takeProfitPercentage}`,
                                    buy: {
                                        holdersCount: {
                                            min: holdersCount,
                                        },
                                        bondingCurveProgress: {
                                            min: bcp,
                                        },
                                        devHoldingPercentage: {
                                            max: dhp,
                                        },
                                        topTenHoldingPercentage: {
                                            max: tthp,
                                        },
                                    },
                                    sell: {
                                        trailingStopLossPercentage: trailingStopLossPercentage,
                                        takeProfitPercentage: takeProfitPercentage,
                                    },
                                };

                                this._resumeState = {
                                    holdersCount,
                                    bondingCurveProgress: bcp,
                                    devHoldingPercentage: dhp,
                                    topTenHoldingPercentage: tthp,
                                    trailingStopLossPercentage,
                                    takeProfitPercentage,
                                };
                            }
                        }
                    }
                }
            }
        }
    }

    get resumeState(): EndState | undefined {
        return this._resumeState;
    }
}
