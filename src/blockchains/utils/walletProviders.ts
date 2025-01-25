import { SolanaWalletProviders } from '../solana/constants/walletProviders';

export const walletProviders = Object.keys(SolanaWalletProviders).map(
    k => SolanaWalletProviders[k as keyof typeof SolanaWalletProviders],
);
