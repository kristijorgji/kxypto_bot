import { Blockchain } from '../../../../src/db/types';
import { generateTradeId } from '../../../../src/trading/utils/generateTradeId';

describe(generateTradeId.name, () => {
    it('should generate a trade_id up to 50 characters', () => {
        const tradeId = generateTradeId('solana', 'DADA');
        expect(tradeId.length).toBeLessThanOrEqual(50);
    });

    it('should contain the blockchain abbreviation', () => {
        const tradeId = generateTradeId('solana', 'DADA');
        expect(tradeId).toContain('solan'); // Should contain the first 6 characters of "solana"
    });

    it('should contain the asset symbol', () => {
        const tradeId = generateTradeId('solana', 'DADA');
        expect(tradeId).toContain('DADA');
    });

    it('should contain the timestamp portion', () => {
        const tradeId = generateTradeId('solana', 'DADA');
        const timestamp = Date.now().toString().slice(0, 12);
        expect(tradeId).toContain(timestamp); // Ensure the timestamp part matches the one generated
    });

    it('should generate a unique trade_id every time', () => {
        const tradeId1 = generateTradeId('solana', 'DADA');
        const tradeId2 = generateTradeId('ethereum', 'DOGE');
        expect(tradeId1).not.toBe(tradeId2); // Different blockchain and asset should result in different trade_id
    });

    it('should generate a random string part', () => {
        const tradeId = generateTradeId('solana', 'DADA');
        const regex = /[a-f0-9]{10}$/; // Checks the last part of trade_id for a 10-character hex string
        expect(regex.test(tradeId)).toBe(true); // The random string should be a 10-character hex string
    });

    it('should handle edge cases with short blockchain and asset symbols', () => {
        const tradeId = generateTradeId('eth' as unknown as Blockchain, 'BTC');
        expect(tradeId.length).toBeLessThanOrEqual(50);
        expect(tradeId).toContain('eth');
        expect(tradeId).toContain('BTC');
    });

    it('should generate trade_id with a maximum length of 50 characters', () => {
        const longBlockchain = 'blockchain_that_is_very_long';
        const tradeId = generateTradeId(longBlockchain as unknown as Blockchain, 'DADA');
        expect(tradeId.length).toBeLessThanOrEqual(50);
    });
});
