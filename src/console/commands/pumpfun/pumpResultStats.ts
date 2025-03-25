import fs from 'fs';

import { lamportsToSol } from '../../../blockchains/utils/amount';
import { logger } from '../../../logger';
import { HandlePumpTokenReport } from '../../../scripts/pumpfun/bot';
import { BotTradeResponse } from '../../../trading/bots/blockchains/solana/types';
import { walkDirFilesSyncRecursive } from '../../../utils/files';

export default function pumpResultStats(args: { path: string }) {
    const pumpfunStatsPath = args.path;
    const files = walkDirFilesSyncRecursive(pumpfunStatsPath, [], 'json');

    let netPlnLamports = 0;

    let lossesCount = 0;
    let lossesAmountLamport = 0;
    let biggestLoss: {
        mint: string;
        amountLamports: number;
    } = {
        mint: '',
        amountLamports: 1,
    };

    let winsCount = 0;
    let winsAmountLamport = 0;
    let biggestWin: {
        mint: string;
        amountLamports: number;
    } = {
        mint: '',
        amountLamports: -1,
    };

    for (const file of files) {
        const content = JSON.parse(fs.readFileSync(file.fullPath).toString()) as HandlePumpTokenReport;

        if (!(content as BotTradeResponse).netPnl) {
            // logger.info('[Skip file] - %s has no trades', file.fullPath);
            continue;
        }

        const netPnl = (content as BotTradeResponse).netPnl;
        if (netPnl.inLamports > 0) {
            winsCount++;
            winsAmountLamport += netPnl.inLamports;
            if (biggestWin.amountLamports < netPnl.inLamports) {
                biggestWin = {
                    mint: content.mint,
                    amountLamports: netPnl.inLamports,
                };
            }
        } else {
            lossesCount++;
            lossesAmountLamport += netPnl.inLamports;
            if (biggestLoss.amountLamports > netPnl.inLamports) {
                biggestLoss = {
                    mint: content.mint,
                    amountLamports: netPnl.inLamports,
                };
            }
        }

        netPlnLamports += netPnl.inLamports;
    }

    logger.info('Total Pnl %s SOL', lamportsToSol(netPlnLamports));
    logger.info('%d wins, %d loses', winsCount, lossesCount);
    logger.info('Total wins %s SOL', lamportsToSol(winsAmountLamport));
    logger.info('Biggest win %o', biggestWin);
    logger.info('Total losses %s SOL', lamportsToSol(lossesAmountLamport));
    logger.info('Biggest loss %o', biggestLoss);
}
