import * as BufferLayout from '@solana/buffer-layout';
import { bool, u64 } from '@solana/buffer-layout-utils';

export default class BondingCurveState {
    readonly virtual_token_reserves: bigint;
    readonly virtual_sol_reserves: bigint;
    readonly real_token_reserves: bigint;
    readonly real_sol_reserves: bigint;
    readonly token_total_supply: bigint;
    readonly complete: boolean;

    constructor(data: Buffer) {
        // @ts-ignore
        const layout = BufferLayout.struct([
            u64('virtual_token_reserves') as BufferLayout.Layout<never>,
            u64('virtual_sol_reserves') as BufferLayout.Layout<never>,
            u64('real_token_reserves') as BufferLayout.Layout<never>,
            u64('real_sol_reserves') as BufferLayout.Layout<never>,
            u64('token_total_supply') as BufferLayout.Layout<never>,
            bool('complete') as BufferLayout.Layout<never>,
        ]);

        const parsed = layout.decode(data.slice(8)) as {
            virtual_token_reserves: bigint;
            virtual_sol_reserves: bigint;
            real_token_reserves: bigint;
            real_sol_reserves: bigint;
            token_total_supply: bigint;
            complete: boolean;
        };

        this.virtual_token_reserves = parsed.virtual_token_reserves;
        this.virtual_sol_reserves = parsed.virtual_sol_reserves;
        this.real_token_reserves = parsed.real_token_reserves;
        this.real_sol_reserves = parsed.real_sol_reserves;
        this.token_total_supply = parsed.token_total_supply;
        this.complete = parsed.complete;
    }
}
