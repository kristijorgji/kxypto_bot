import fs from 'fs';

import { SolanaWalletProviders } from '../../blockchains/solana/constants/walletProviders';
import solanaMnemonicToKeypair from '../../blockchains/solana/utils/solanaMnemonicToKeypair';
import { walletProviders } from '../../blockchains/utils/walletProviders';
import { logger } from '../../logger';
import { ensureDataFolder } from '../../utils/storage';

export default async function getWalletInfo(args: {
    blockchain: 'solana';
    recoveryPhrasePath: string;
    provider: keyof typeof SolanaWalletProviders;
}) {
    if (!walletProviders.includes(args.provider)) {
        throw new Error(`The provider ${args.provider} is not supported. Supported: [${walletProviders.join(',')}]`);
    }

    const recoveryPhrase = fs.readFileSync(args.recoveryPhrasePath).toString().trimStart().trimEnd();

    const info = await solanaMnemonicToKeypair(recoveryPhrase, {
        provider: args.provider,
    });

    const fullStoragePath = ensureDataFolder(`walletInfo/${args.blockchain}/${info.address}.json`);

    fs.writeFileSync(fullStoragePath, JSON.stringify(info, null, 2));

    logger.info(`Your wallet info are stored at: ${fullStoragePath}`);
}
