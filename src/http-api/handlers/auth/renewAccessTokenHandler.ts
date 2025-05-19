import { Response as ExpressResponse, Request } from 'express';
import jwt from 'jsonwebtoken';

import { db } from '../../../db/knex';
import { Tables } from '../../../db/tables';
import { Session } from '../../../db/types';
import { RefreshTokenPayload, generateAccessToken } from '../../../services/auth';
import { formatDateIso8601WithOffset } from '../../../utils/time';
import { errorResponse } from '../../utils/res_utils';

type RequestBody = {
    refreshToken: string;
};

export default async (req: Request, res: ExpressResponse) => {
    const body = req.body as RequestBody;
    const refreshToken = body.refreshToken;

    const refreshPayload = jwt.verify(
        refreshToken,
        process.env.AUTH_REFRESH_TOKEN_SECRET as string,
    ) as RefreshTokenPayload;

    const session = await db
        .table(Tables.Sessions)
        .select<Session>()
        .where({
            id: refreshPayload.tokenId,
        })
        .first();

    if (!session) {
        res.status(404).send();
        return;
    }

    let errorCode: string | undefined;

    if (session.is_blocked) {
        errorCode = 'blocked';
    } else if (session.user_id !== refreshPayload.userId) {
        errorCode = 'incorrect_user';
    } else if (session.refresh_token !== refreshToken) {
        errorCode = 'mismatched_session_token';
    } else if (Date.now() > session.expires_at * 1000) {
        errorCode = 'expired_session';
    }

    if (errorCode) {
        res.status(401).json(errorResponse({ code: errorCode }));
        return;
    }

    const accessToken = await generateAccessToken(
        {
            issuer: process.env.AUTH_TOKEN_ISSUER as string,
            secret: process.env.AUTH_ACCESS_TOKEN_SECRET as string,
            expiry: process.env.AUTH_ACCESS_TOKEN_EXPIRY as string,
        },
        {
            userId: refreshPayload.userId,
        },
    );

    res.status(200).json({
        accessToken: accessToken.token,
        accessTokenExpiresAt: formatDateIso8601WithOffset(accessToken.expiresAt),
    });
};
