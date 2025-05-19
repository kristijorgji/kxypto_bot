import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import parse from 'parse-duration';
import { v4 as uuidv4 } from 'uuid';

export enum TokenType {
    Access = 'access',
    Refresh = 'refresh',
}

export async function hashPassword(input: string): Promise<string> {
    const saltRounds = 10;

    return await bcrypt.hash(input, saltRounds);
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
    return await bcrypt.compare(password, hashedPassword);
}

type TokenConfig = {
    issuer: string;
    secret: string;
    /** a string describing a time span [zeit/ms](https://github.com/zeit/ms.js).  Eg: 60, "2 days", "10h", "7d" */
    expiry: string;
};

type GenerateTokenPayload = {
    userId: string;
};

export type RefreshTokenPayload = {
    tokenType: TokenType.Refresh;
    tokenId: string;
    userId: string;
};

export async function generateAccessToken(
    config: TokenConfig,
    payload: GenerateTokenPayload,
): Promise<{
    token: string;
    expiresAt: Date;
}> {
    const expiresInMs = parse(config.expiry, 'ms');
    if (!expiresInMs) {
        throw new Error(`Unknown expiry format ${config.expiry}`);
    }
    const expiryDate = new Date(Date.now() + expiresInMs);

    return {
        token: jwt.sign(
            {
                tokenType: TokenType.Access,
                userId: payload.userId,
            },
            config.secret,
            {
                issuer: config.issuer,
                expiresIn: config.expiry,
            },
        ),
        expiresAt: expiryDate,
    };
}

export async function generateRefreshToken(
    config: TokenConfig,
    payload: GenerateTokenPayload,
): Promise<{
    id: string;
    token: string;
    expiresAt: Date;
}> {
    const tokenId = uuidv4();

    const expiresInMs = parse(config.expiry, 'ms');
    if (!expiresInMs) {
        throw new Error(`Unknown expiry format ${config.expiry}`);
    }
    const expiryDate = new Date(Date.now() + expiresInMs);

    const refreshToken: string = jwt.sign(
        {
            tokenId: tokenId,
            tokenType: TokenType.Refresh,
            userId: payload.userId,
        },
        config.secret,
        {
            issuer: config.issuer,
            expiresIn: config.expiry,
        },
    );

    return {
        id: tokenId,
        token: refreshToken,
        expiresAt: expiryDate,
    };
}
