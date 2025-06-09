import { PublicKey, SystemProgram } from '@solana/web3.js';

export const SYSTEM_PROGRAM_ID = SystemProgram.programId;
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const RENT = new PublicKey('SysvarRent111111111111111111111111111111111');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

export const PUMP_GLOBAL = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
export const PUMP_FEE_RECIPIENT = new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM');
export const PUMP_FUN_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
export const PUMP_AMM_PROGRAM = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
export const PUMP_FUN_ACCOUNT = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');
export const PUMP_GLOBAL_CONFIG = new PublicKey('ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw');
export const PUMP_PROTOCOL_FEE_RECIPIENT = new PublicKey('FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz');
export const PUMP_PROTOCOL_FEE_RECIPIENT_TOKEN_ACCOUNT = new PublicKey('7xQYoUjUJF1Kg6WVczoTAkaNhn5syQYcbvjmFrhjWpx');
export const PUMP_BUY_BUFFER = Buffer.from([0x66, 0x06, 0x3d, 0x12, 0x01, 0xda, 0xeb, 0xea]);
export const PUMP_SELL_BUFFER = Buffer.from([0x33, 0xe6, 0x85, 0xa4, 0x01, 0x7f, 0x83, 0xad]);

export const PUMPFUN_TOKEN_DECIMALS = 6;
export const PUMPFUN_TOKEN_SUPPLY = 1e9 * 10 ** PUMPFUN_TOKEN_DECIMALS;
