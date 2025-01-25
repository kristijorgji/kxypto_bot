import { program } from 'commander';

import getWalletInfo from './commands/getWalletInfo';

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

program.parse();
