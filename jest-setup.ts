process.env = Object.assign(process.env, {
    SOLANA_RPC_ENDPOINT: 'https://cunat-mainnet-testing.test',
    SOLANA_WSS_ENDPOINT: 'ws://localhost:1234',
    PRICE_PREDICTION_ENDPOINT: 'http://test.local:8000/solana/pumpfun/predict/xgboost',
});
