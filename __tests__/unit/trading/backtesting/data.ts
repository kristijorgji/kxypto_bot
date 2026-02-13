import { BacktestStrategyRunConfig } from '../../../../src/trading/bots/blockchains/solana/types';

export const randomizationNoneConfig: BacktestStrategyRunConfig['randomization'] = {
    priorityFees: false,
    slippages: 'off',
    execution: false,
};
