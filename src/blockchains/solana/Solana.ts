import { Connection, PublicKey } from '@solana/web3.js';

export default class Solana {
    async getCirculatingSupply(connection: Connection, tokenAddress: string) {
        return await connection.getTokenSupply(new PublicKey(tokenAddress));
    }
}
