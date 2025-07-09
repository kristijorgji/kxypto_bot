import { Response as ExpressResponse, Request } from 'express';
import jwt from 'jsonwebtoken';

import { db } from '@src/db/knex';
import { Tables } from '@src/db/tables';
import { RefreshTokenPayload, TokenType } from '@src/services/auth';

import { extractBearerToken } from '../../utils/req_utils';
import { errorResponse } from '../../utils/res_utils';

type RequestBody = {
    refreshToken: string;
};

export default async (req: Request, res: ExpressResponse) => {
    const body = req.body as RequestBody;
    const refreshToken = body.refreshToken;

    const accessToken = extractBearerToken(req);
    if (accessToken === null) {
        res.status(400).json(
            errorResponse({
                code: 'no_token',
            }),
        );
        return;
    }

    const refreshTokenPayload = jwt.decode(refreshToken) as RefreshTokenPayload;

    if (refreshTokenPayload.tokenType !== TokenType.Refresh) {
        res.status(401).json(
            errorResponse({
                code: 'wrong_token_type',
            }),
        );
        return;
    }

    await db.table(Tables.Sessions).where({ id: refreshTokenPayload.tokenId }).update({
        is_blocked: true,
    });

    /**
     * TODO invalidate the accessToken in the authorization header
     */

    res.status(200).send();
};
