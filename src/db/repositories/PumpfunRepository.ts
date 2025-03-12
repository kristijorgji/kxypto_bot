import { Knex } from 'knex';

import { PumpfunInitialCoinData } from '../../blockchains/solana/dex/pumpfun/types';
import { db } from '../knex';
import { Tables } from '../tables';
import { Token } from '../types';

export const CreatedOnPumpfun = 'https://pump.fun';

type PumpTokenOther = {
    creator: string;
    bondingCurve: string;
    associatedBondingCurve: string;
    description: string;
    image: string;
    twitter?: string;
    telegram?: string;
    website?: string;
};

export default class PumpfunRepository {
    // eslint-disable-next-line no-useless-constructor
    constructor(private readonly db: Knex) {}

    async insertToken(data: PumpfunInitialCoinData): Promise<void> {
        const { mint, name, symbol, createdTimestamp, ...other } = data;

        const tokenDbEntry: Token = {
            chain: 'solana',
            mint: mint,
            name: name,
            symbol: symbol,
            other: other,
            createdOn: CreatedOnPumpfun,
            token_created_at: createdTimestamp ? new Date(createdTimestamp) : new Date(),
        };
        await this.db.table(Tables.Tokens).insert(tokenDbEntry);
    }

    async getToken(mint: string): Promise<PumpfunInitialCoinData | undefined> {
        const result = await this.db
            .table(Tables.Tokens)
            .select<Token<PumpTokenOther>>()
            .where({
                mint: mint,
            })
            .first();

        return result === undefined ? undefined : this.mapTokenToPumpfunInitialCoinData(result);
    }

    async getTokens(): Promise<PumpfunInitialCoinData[]> {
        const query = this.db
            .table(Tables.Tokens)
            .select<Token[]>()
            .where({
                createdOn: CreatedOnPumpfun,
            })
            .orderBy('created_at', 'desc');

        return ((await query) as Token<PumpTokenOther>[]).map(this.mapTokenToPumpfunInitialCoinData);
    }

    private mapTokenToPumpfunInitialCoinData(e: Token<PumpTokenOther>): PumpfunInitialCoinData {
        return {
            mint: e.mint,
            creator: e.other.creator,
            createdTimestamp: e.token_created_at.getTime(),
            bondingCurve: e.other.bondingCurve,
            associatedBondingCurve: e.other.associatedBondingCurve,
            name: e.name,
            symbol: e.symbol,
            description: e.other.description,
            image: e.other.image,
            twitter: e.other?.twitter,
            telegram: e.other?.telegram,
            website: e.other?.website,
        };
    }
}

export const pumpfunRepository = new PumpfunRepository(db);
