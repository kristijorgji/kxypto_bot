import { program } from 'commander';

import getWalletInfo from './commands/getWalletInfo';
import pumpResultStats from './commands/pumpfun/pumpResultStats';

program.name('crypto_bot CLI').description('Crypto Bot Cli by @kristijorgji').version('0.0.0');

program
    .command('walletInfo:solana')
    .description('Will provide wallet private key base58 encoded and its public address ')
    .requiredOption('--recoveryPhrasePath <string>', 'your wallet recovery phrase text file absolute path')
    .requiredOption('--provider <string>', 'your wallet provider, ex: TrustWallet|Standard')
    .action(async args => {
        await getWalletInfo({
            blockchain: 'solana',
            recoveryPhrasePath: args.recoveryPhrasePath,
            provider: args.provider,
        });
    });

program
    .command('pumpfun:results-stats')
    .description('Will provide the stats for the given json results folder')
    .requiredOption('--path <string>', 'the path of the pumpfun stats')
    .action(async args => {
        await pumpResultStats({
            path: args.path,
        });
    });

program.parse();
