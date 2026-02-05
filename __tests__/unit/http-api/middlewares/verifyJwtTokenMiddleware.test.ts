import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import verifyJwtTokenMiddleware from '../../../../src/http-api/middlewares/verifyJwtTokenMiddleware';
import { extractBearerToken } from '../../../../src/http-api/utils/req_utils';

jest.mock('jsonwebtoken');

jest.mock('../../../../src/http-api/utils/req_utils');

describe('verifyJwtTokenMiddleware', () => {
    let mockRequest: Partial<Request>;
    let mockResponse: Partial<Response>;
    let nextFunction: NextFunction = jest.fn();

    beforeEach(() => {
        // Reset mocks and process.env before each test
        jest.clearAllMocks();
        process.env.AUTH_ACCESS_TOKEN_SECRET = 'test-secret';

        mockRequest = {};
        mockResponse = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };
    });

    it('should call next() and attach payload if token is valid', () => {
        const mockPayload = { userId: 'user-123' };
        (extractBearerToken as jest.Mock).mockReturnValue('valid-token');
        (jwt.verify as jest.Mock).mockReturnValue(mockPayload);

        verifyJwtTokenMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);

        expect(jwt.verify).toHaveBeenCalledWith('valid-token', 'test-secret');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((mockRequest as any).jwtPayload).toEqual(mockPayload);
        expect(nextFunction).toHaveBeenCalled();
    });

    it('should return 401 if no token is provided', () => {
        (extractBearerToken as jest.Mock).mockReturnValue(null);

        verifyJwtTokenMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);

        expect(mockResponse.status).toHaveBeenCalledWith(401);
        expect(mockResponse.json).toHaveBeenCalledWith({ message: 'No token provided' });
        expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should return token_expired code if JWT is expired', () => {
        (extractBearerToken as jest.Mock).mockReturnValue('expired-token');

        const expiredError = new Error();
        expiredError.name = 'TokenExpiredError';
        (jwt.verify as jest.Mock).mockImplementation(() => {
            throw expiredError;
        });

        verifyJwtTokenMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);

        expect(mockResponse.status).toHaveBeenCalledWith(401);
        expect(mockResponse.json).toHaveBeenCalledWith({ code: 'token_expired' });
    });

    it('should return generic auth failure for invalid tokens', () => {
        (extractBearerToken as jest.Mock).mockReturnValue('garbage-token');
        (jwt.verify as jest.Mock).mockImplementation(() => {
            throw new Error('JsonWebTokenError');
        });

        verifyJwtTokenMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);

        expect(mockResponse.status).toHaveBeenCalledWith(401);
        expect(mockResponse.json).toHaveBeenCalledWith({ message: 'Failed to authenticate token' });
    });
});
