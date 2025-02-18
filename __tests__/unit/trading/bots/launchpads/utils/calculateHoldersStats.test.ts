import { PUMPFUN_TOKEN_SUPPLY } from '../../../../../../src/blockchains/solana/dex/pumpfun/constants';
import calculateHoldersStats from '../../../../../../src/trading/bots/launchpads/utils/calculateHoldersStats';

describe(calculateHoldersStats.name, () => {
    it('should calculate properly and not include the bondingCurve (liquidity pool)', () => {
        const actual = calculateHoldersStats({
            tokenHolders: [
                {
                    tokenAccountAddress: '9XomdTPGXQCSyR158u2jQqmNVgkLzYSZwLUZVx9X76AS',
                    ownerAddress: 'BnHqd8sfzzrcFc2FeTYMEacRb6qDi4cm7xEj4SRmdALN',
                    balance: 981734227521195,
                },
                {
                    tokenAccountAddress: 'DqNu6DSdV9hGPyFtdosmtKMeD7KvkWQk73xDz2p4YXxR',
                    ownerAddress: 'HoSSbLeRnJct3ajdMgzs33ymukymr6aeeom8DQMf3B88',
                    balance: 14297133655659,
                },
                {
                    tokenAccountAddress: 'GcJiqCUoa4PjYKbe64yXGQbHYokqwXp5MJaFbMVjcMUg',
                    ownerAddress: 'AaDq9jZkxTh7Pzr6LMz7xh7Uia4mDaVgBYoBUFQDZT7k',
                    balance: 3576537911301,
                },
                {
                    tokenAccountAddress: 'AwJ5ActJ2arUQSdaLswR8H8DHxzw2zaGa6kgQmvegwLX',
                    ownerAddress: '9npZNupg1sXAwfeA1UF9nbqk1skC5hAUqcNX6sYXfV4S',
                    balance: 357547484171,
                },
                {
                    tokenAccountAddress: '6Cv6y9925VW2Za36x2GAK67nU1NCuBZ62vKtEQUiuUnk',
                    ownerAddress: '2wfhrKdeyHu7VGYoMnWF8Xh5Tf6wrERj64MtyTh3CeaL',
                    balance: 34553427674,
                },
            ],
            totalSupply: PUMPFUN_TOKEN_SUPPLY,
            creator: '9npZNupg1sXAwfeA1UF9nbqk1skC5hAUqcNX6sYXfV4S',
            bondingCurve: 'BnHqd8sfzzrcFc2FeTYMEacRb6qDi4cm7xEj4SRmdALN',
        });

        expect(actual).toEqual({
            holdersCount: 5,
            devHoldingPercentage: 0.0357547484171,
            topTenHoldingPercentage: 1.8265772478804998,
        });
    });
});
