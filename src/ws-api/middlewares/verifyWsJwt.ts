import jwt, { TokenExpiredError } from 'jsonwebtoken';

import { JwtPayload } from '@src/http-api/middlewares/verifyJwtTokenMiddleware';

export function verifyWsJwt(token: string): JwtPayload {
    if (!token) throw new Error('No token provided');

    try {
        return jwt.verify(token, process.env.AUTH_ACCESS_TOKEN_SECRET!) as JwtPayload;
    } catch (err) {
        if ((err as TokenExpiredError).name === 'TokenExpiredError') {
            throw new Error('token_expired');
        }
        throw new Error('Failed to authenticate token');
    }
}
