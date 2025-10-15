import normalizeStackTrace from '@src/utils/stackTrace/normalizeStackTrace';

process.env = Object.assign(process.env, {
    SOLANA_RPC_ENDPOINT: 'https://cunat-mainnet-testing.test',
    SOLANA_WSS_ENDPOINT: 'ws://localhost:1234',
    WALLET_MNEMONIC_PHRASE: 'acoustic cry comic palace merge ask spread coconut negative meadow loop merge',
    PRICE_PREDICTION_ENDPOINT: 'http://test.local:8000/solana/pumpfun/predict/xgboost',
    BUY_PREDICTION_ENDPOINT: 'http://127.0.0.1:8000/solana/pumpfun/predict/a-transformer',
    APP_WS_PORT: 7777,
});

beforeEach(() => {
    const originalPrepareStackTrace = Error.prepareStackTrace;

    Error.prepareStackTrace = (err, structuredStackTrace) => {
        const stack = originalPrepareStackTrace ? originalPrepareStackTrace(err, structuredStackTrace) : err.stack;

        if (typeof stack === 'string') {
            return normalizeStackTrace(err);
        }

        return stack;
    };
});
