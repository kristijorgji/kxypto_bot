import { formDataFolder } from '@src/utils/storage';

export function formPumpfunBacktestStatsDir(): string {
    return formDataFolder('pumpfun-stats/backtest');
}
