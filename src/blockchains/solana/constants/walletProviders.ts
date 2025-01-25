/* eslint-disable quotes */

export const SolanaWalletProviders = {
    Standard: 'Standard',
    TrustWallet: 'TrustWallet',
} as const;

export const solanaDerivationPaths: Record<typeof SolanaWalletProviders[keyof typeof SolanaWalletProviders], string> = {
    Standard: "m/44'/501'/0'/0'",
    TrustWallet: "m/44'/501'/0'",
};
