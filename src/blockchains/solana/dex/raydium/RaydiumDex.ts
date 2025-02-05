import fs from 'fs';

import { Wallet } from '@coral-xyz/anchor';
import {
    Liquidity,
    LiquidityPoolJsonInfo,
    LiquidityPoolKeys,
    Percent,
    SPL_ACCOUNT_LAYOUT,
    TOKEN_PROGRAM_ID,
    Token,
    TokenAccount,
    TokenAmount,
    jsonInfo2PoolKeys,
} from '@raydium-io/raydium-sdk';
import {
    Connection,
    PublicKey,
    RpcResponseAndContext,
    SimulatedTransactionResponse,
    Transaction,
    TransactionMessage,
    VersionedTransaction,
} from '@solana/web3.js';

import { solanaPrivateKeyToKeypair } from '../../utils/solanaPrivateKeyToKeypair';

export type RaydiumDexConfig = {
    rpcUrl: string;
    walletPrivateKey: string;
    liquidityFile: string;
};

class RaydiumDex {
    allPoolKeysJson: LiquidityPoolJsonInfo[] = [];
    connection: Connection;
    wallet: Wallet;

    constructor({ rpcUrl, walletPrivateKey }: RaydiumDexConfig) {
        this.connection = new Connection(rpcUrl, { commitment: 'confirmed' });
        this.wallet = new Wallet(solanaPrivateKeyToKeypair(walletPrivateKey));
    }

    /**
     * Loads all the pool keys available from a JSON configuration file.
     * @async
     * @returns {Promise<void>}
     */
    loadPoolKeys = async (liquidityFile: string): Promise<void> => {
        let liquidityJson;
        if (liquidityFile.startsWith('http')) {
            const liquidityJsonResp = await fetch(liquidityFile);
            if (!liquidityJsonResp.ok) {
                return;
            }
            liquidityJson = await liquidityJsonResp.json();
        } else {
            liquidityJson = JSON.parse(await fs.promises.readFile(liquidityFile, 'utf-8'));
        }

        this.allPoolKeysJson = [...(liquidityJson?.official ?? []), ...(liquidityJson?.unOfficial ?? [])];
    };

    /**
     * Finds pool information for the given token pair.
     * @param {string} mintA - The mint address of the first token.
     * @param {string} mintB - The mint address of the second token.
     * @returns {LiquidityPoolKeys | null} The liquidity pool keys if found, otherwise null.
     */
    findPoolInfoForTokens = (mintA: string, mintB: string): LiquidityPoolKeys | null => {
        const poolData = this.allPoolKeysJson.find(
            i => (i.baseMint === mintA && i.quoteMint === mintB) || (i.baseMint === mintB && i.quoteMint === mintA),
        );

        if (!poolData) {
            return null;
        }

        return jsonInfo2PoolKeys(poolData) as LiquidityPoolKeys;
    };

    /**
     * Retrieves token accounts owned by the wallet.
     * @async
     * @returns {Promise<TokenAccount[]>} An array of token accounts.
     */
    getOwnerTokenAccounts = async (): Promise<TokenAccount[]> => {
        const walletTokenAccount = await this.connection.getTokenAccountsByOwner(this.wallet.publicKey, {
            programId: TOKEN_PROGRAM_ID,
        });

        return walletTokenAccount.value.map(i => ({
            pubkey: i.pubkey,
            programId: i.account.owner,
            accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data),
        }));
    };

    /**
     * Builds a swap transaction.
     * @async
     * @param {string} toToken - The mint address of the token to receive.
     * @param {number} amount - The amount of the token to swap.
     * @param {LiquidityPoolKeys} poolKeys - The liquidity pool keys.
     * @param {number} [maxLamports=100000] - The maximum lamports to use for transaction fees.
     * @param {'in' | 'out'} [fixedSide='in'] - The fixed side of the swap ('in' or 'out').
     * @returns {Promise<Transaction | VersionedTransaction>} The constructed swap transaction.
     */
    async getSwapTransaction(
        toToken: string,
        // fromToken: string,
        amount: number,
        poolKeys: LiquidityPoolKeys,
        maxLamports: number = 100000,
        fixedSide: 'in' | 'out' = 'in',
    ): Promise<Transaction | VersionedTransaction> {
        const directionIn = poolKeys.quoteMint.toString() === toToken;
        const { minAmountOut, amountIn } = await this.calcAmountOut(poolKeys, amount, directionIn);
        const userTokenAccounts = await this.getOwnerTokenAccounts();
        const swapTransaction = await Liquidity.makeSwapInstructionSimple({
            connection: this.connection,
            makeTxVersion: 0,
            poolKeys: {
                ...poolKeys,
            },
            userKeys: {
                tokenAccounts: userTokenAccounts,
                owner: this.wallet.publicKey,
            },
            amountIn: amountIn,
            amountOut: minAmountOut,
            fixedSide: fixedSide,
            config: {
                bypassAssociatedCheck: false,
            },
            computeBudgetConfig: {
                microLamports: maxLamports,
            },
        });

        const recentBlockhashForSwap = await this.connection.getLatestBlockhash();
        const instructions = swapTransaction.innerTransactions[0].instructions.filter(Boolean);

        const versionedTransaction = new VersionedTransaction(
            new TransactionMessage({
                payerKey: this.wallet.publicKey,
                recentBlockhash: recentBlockhashForSwap.blockhash,
                instructions: instructions,
            }).compileToV0Message(),
        );

        versionedTransaction.sign([this.wallet.payer]);

        return versionedTransaction;
    }

    /**
     * Sends a versioned transaction.
     * @async
     * @param {VersionedTransaction} tx - The versioned transaction to send.
     * @param maxRetries
     * @returns {Promise<string>} The transaction ID.
     */
    sendVersionedTransaction = async (tx: VersionedTransaction, maxRetries?: number): Promise<string> => {
        return await this.connection.sendTransaction(tx, {
            skipPreflight: true,
            maxRetries: maxRetries,
        });
    };

    /**
     * Simulates a versioned transaction.
     * @async
     * @param {VersionedTransaction} tx - The versioned transaction to simulate.
     * @returns {Promise<any>} The simulation result.
     */
    simulateVersionedTransaction = async (
        tx: VersionedTransaction,
    ): Promise<RpcResponseAndContext<SimulatedTransactionResponse>> => {
        return await this.connection.simulateTransaction(tx);
    };

    /**
     * Gets a token account by owner and mint address.
     * @param {PublicKey} mint - The mint address of the token.
     * @returns {TokenAccount} The token account.
     */
    static getTokenAccountByOwnerAndMint(mint: PublicKey): TokenAccount {
        return {
            programId: TOKEN_PROGRAM_ID,
            pubkey: PublicKey.default,
            accountInfo: {
                mint: mint,
                amount: 0,
            },
        } as unknown as TokenAccount;
    }

    /**
     * Calculates the amount out for a swap.
     * @async
     * @param {LiquidityPoolKeys} poolKeys - The liquidity pool keys.
     * @param {number} rawAmountIn - The raw amount of the input token.
     * @param {boolean} swapInDirection - The direction of the swap (true for in, false for out).
     * @returns {Promise<Object>} The swap calculation result.
     */
    async calcAmountOut(poolKeys: LiquidityPoolKeys, rawAmountIn: number, swapInDirection: boolean) {
        const poolInfo = await Liquidity.fetchInfo({ connection: this.connection, poolKeys });

        let currencyInMint = poolKeys.baseMint;
        let currencyInDecimals = poolInfo.baseDecimals;
        let currencyOutMint = poolKeys.quoteMint;
        let currencyOutDecimals = poolInfo.quoteDecimals;

        if (!swapInDirection) {
            currencyInMint = poolKeys.quoteMint;
            currencyInDecimals = poolInfo.quoteDecimals;
            currencyOutMint = poolKeys.baseMint;
            currencyOutDecimals = poolInfo.baseDecimals;
        }

        const currencyIn = new Token(TOKEN_PROGRAM_ID, currencyInMint, currencyInDecimals);
        const amountIn = new TokenAmount(currencyIn, rawAmountIn, false);
        const currencyOut = new Token(TOKEN_PROGRAM_ID, currencyOutMint, currencyOutDecimals);
        const slippage = new Percent(5, 100); // 5% slippage

        const { amountOut, minAmountOut, currentPrice, executionPrice, priceImpact, fee } = Liquidity.computeAmountOut({
            poolKeys,
            poolInfo,
            amountIn,
            currencyOut,
            slippage,
        });

        return {
            amountIn,
            amountOut,
            minAmountOut,
            currentPrice,
            executionPrice,
            priceImpact,
            fee,
        };
    }
}

export default RaydiumDex;
