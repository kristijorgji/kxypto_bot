import { Response as ExpressResponse, Request } from 'express';

import { db } from '../../../db/knex';
import { Tables } from '../../../db/tables';
import { User } from '../../../db/types';
import { generateAccessToken, generateRefreshToken, verifyPassword } from '../../../services/auth';
import { formatDateIso8601WithOffset } from '../../../utils/time';
import { getClientVersion, getPlatform } from '../../utils/req_utils';

type RequestBody = {
    email: string;
    password: string;
};

export default async (req: Request, res: ExpressResponse) => {
    const body = req.body as RequestBody;

    const user = await db
        .table(Tables.Users)
        .select<User>()
        .where({
            email: body.email,
        })
        .first();

    if (!user) {
        res.status(401).send();
        return;
    }

    if (!(await verifyPassword(body.password, user.password))) {
        res.status(401).send();
        return;
    }

    const accessToken = await generateAccessToken(
        {
            issuer: process.env.AUTH_TOKEN_ISSUER as string,
            secret: process.env.AUTH_ACCESS_TOKEN_SECRET as string,
            expiry: process.env.AUTH_ACCESS_TOKEN_EXPIRY as string,
        },
        {
            userId: user.id,
        },
    );

    const refreshToken = await generateRefreshToken(
        {
            issuer: process.env.AUTH_TOKEN_ISSUER as string,
            secret: process.env.AUTH_REFRESH_TOKEN_SECRET as string,
            expiry: process.env.AUTH_REFRESH_TOKEN_EXPIRY as string,
        },
        {
            userId: user.id,
        },
    );

    await db.table(Tables.Sessions).insert({
        id: refreshToken.id,
        user_id: user.id,
        refresh_token: refreshToken.token,
        user_agent: req.headers['user-agent'],
        client_ip: req.ip,
        platform: getPlatform(req.headers['user-agent'] ?? ''),
        app_version: getClientVersion(req),
        is_blocked: false,
        expires_at: Math.floor(refreshToken.expiresAt.getTime() / 1000),
    });

    res.status(200).json({
        userId: user.id,
        sessionId: refreshToken.id,
        accessToken: accessToken.token,
        accessTokenExpiresAt: formatDateIso8601WithOffset(accessToken.expiresAt),
        refreshToken: refreshToken.token,
        refreshTokenExpiresAt: formatDateIso8601WithOffset(refreshToken.expiresAt),
    });
};
