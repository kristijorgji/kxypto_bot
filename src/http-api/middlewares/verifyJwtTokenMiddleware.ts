import { NextFunction, Request, Response } from 'express';
import jwt, { TokenExpiredError } from 'jsonwebtoken';

import { ExtendedRequest } from '../types';
import { extractBearerToken } from '../utils/req_utils';

export type JwtPayload = {
    userId: string;
};

const verifyJwtTokenMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const token = extractBearerToken(req);

    if (!token) {
        res.status(401).json({ message: 'No token provided' });
        return;
    }

    try {
        (req as ExtendedRequest).jwtPayload = jwt.verify(
            token,
            process.env.AUTH_ACCESS_TOKEN_SECRET as string,
        ) as JwtPayload;

        next();
    } catch (err) {
        if ((err as TokenExpiredError).name === 'TokenExpiredError') {
            res.status(401).json({ code: 'token_expired' });
            return;
        }

        res.status(401).json({ message: 'Failed to authenticate token' });
    }
};

export default verifyJwtTokenMiddleware;
