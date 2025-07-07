import { PumpfunInitialCoinData } from '../../../../../src/blockchains/solana/dex/pumpfun/types';
import { PumpfunPositionMeta } from '../../../../../src/trading/bots/blockchains/solana/types';

export const dummyPumpfunTokenInfo: PumpfunInitialCoinData = {
    mint: '5xNMMoEQcQiJQURE6DEwvHVt1jJsMTLrFmBHZoqpump',
    creator: '5toWw4R3RPV8KuA4VF4R153yJbwqrvqtU2cNzesiHjKW',
    createdTimestamp: 1740056496720,
    bondingCurve: 'BGrF4MKYiy5WnodhReU1ThqxkpFJfvqSGfVAkgFcTqaq',
    associatedBondingCurve: '5XMryrPBvant2bZ4zweqFfiEggu4PBhbWZi7St8cRfNo',
    name: 'Oracle Framework',
    symbol: 'ORACLE',
    description: 'oracle framework is the easiest way to bring your agent to life. ',
    image: 'https://ipfs.io/ipfs/Qme4SLfMZbbwr1bvoLy5WCGwJGE68GBMBqKJw2ng4nMswB',
    twitter: 'https://x.com/oracleframework',
    telegram: 'https://t.me/oracleframeworkmeme',
    website: 'http://oracleframework.ai',
};

export const dummyPumpfunPositionMetadata = (creator: string, bondingCurve: string): PumpfunPositionMeta => {
    return {
        startActionBondingCurveState: {
            dev: creator,
            bondingCurve: bondingCurve,
            virtualSolReserves: 58569661730,
            virtualTokenReserves: 1043137958064512,
            realTokenReserves: 766800000000000,
            realSolReserves: 753797654,
            tokenTotalSupply: 1000000000000000,
            complete: false,
        },
        price: {
            calculationMode: 'simulation',
        },
    };
};
