import { SellReason } from '../../trading/bots/types';
import { db } from '../knex';
import { Tables } from '../tables';
import { InsertPosition, Position } from '../types';

export const insertPosition = async (position: InsertPosition): Promise<void> => {
    await db(Tables.Positions).insert(position);
};

export async function closePosition(
    tradeId: string,
    args: {
        saleTxSignature: string;
        closeReason: SellReason;
        exitPrice: number;
        realizedProfit: number;
        exitAmount: number;
    },
) {
    await db(Tables.Positions).where('trade_id', tradeId).andWhere('status', 'open').update({
        status: 'closed',
        closed_at: db.fn.now(),
        close_reason: args.closeReason,
        exit_tx_signature: args.saleTxSignature,
        exit_price: args.exitPrice,
        realized_profit: args.realizedProfit,
        exit_amount: args.exitAmount,
    });
}

export async function getPosition(tradeId: string): Promise<Position> {
    const r = await db.table(Tables.Positions).select<Position>().where('trade_id', tradeId).first();
    if (!r) {
        throw new Error(`Position with trade_id ${tradeId} was not found`);
    }

    return r;
}
