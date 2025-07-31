import { faker } from '@faker-js/faker';

import { lamportsToSol } from '@src/blockchains/utils/amount';
import { HistoryEntryFactory } from '@src/testdata/factories/launchpad';
import { randomPriceSol } from '@src/testdata/factories/solana';
import { HistoryRef, TradeTransaction } from '@src/trading/bots/blockchains/solana/types';
import { SwapSubCategory } from '@src/trading/bots/types';
import { pickRandomItem, randomInt } from '@src/utils/data/data';

export function TradeTransactionFactory(copy?: Partial<TradeTransaction>): TradeTransaction {
    const boughtTokenName = faker.person.firstName();
    const boughtTokenSymbol = boughtTokenName.slice(2);

    const transactionType = pickRandomItem(['buy', 'sell']);
    const subCategory: SwapSubCategory =
        transactionType === 'buy'
            ? pickRandomItem(['newPosition', 'accumulation'])
            : pickRandomItem(['partialSell', 'sellAll']);

    const boughtAmountRaw = faker.number.int({
        min: 1e4,
        max: 1e7,
    });
    const pricePerTokenLamports = randomPriceSol();
    const grossTransferredLamports = boughtAmountRaw * pricePerTokenLamports;

    const soldTokenName = faker.person.firstName();
    const soldTokenSymbol = soldTokenName.slice(2);

    const historyEntry = HistoryEntryFactory();
    const historyRef: HistoryRef = {
        index: faker.number.int({
            min: 12,
            max: 1e3,
        }),
        timestamp: historyEntry.timestamp,
    };

    return {
        timestamp: copy?.timestamp ?? faker.date.past().getTime(),
        transactionType: pickRandomItem(['buy', 'sell']),
        subCategory: subCategory,
        transactionHash: faker.string.alphanumeric(),
        walletAddress: faker.string.alphanumeric(),
        bought: {
            address: faker.string.alphanumeric(),
            name: boughtTokenName,
            symbol: boughtTokenSymbol,
            amount: faker.number.int(),
        },
        sold: {
            address: faker.string.alphanumeric(),
            name: soldTokenName,
            symbol: soldTokenSymbol,
            amount: faker.number.int(),
        },
        amountRaw: boughtAmountRaw,
        grossTransferredLamports: grossTransferredLamports,
        netTransferredLamports: grossTransferredLamports - (randomInt(1, 10) * grossTransferredLamports) / 100,
        price: {
            inLamports: pricePerTokenLamports,
            inSol: lamportsToSol(pricePerTokenLamports),
        },
        marketCap: pricePerTokenLamports * boughtAmountRaw * (1 + randomInt(1, 100) / 100),
        metadata: {
            historyRef: historyRef,
            historyEntry: historyEntry,
        },
    };
}
