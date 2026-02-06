import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

import {
    InferReq,
    RequestSchemaObject,
    validateRequestMiddleware,
} from '../../../../src/http-api/middlewares/validateRequestMiddleware';
import { DeepPartial } from '../../../../src/utils/types';

describe('validateRequestMiddleware', () => {
    interface MockResponse {
        status: jest.Mock;
        json: jest.Mock;
    }

    const createMockResponse = (): Response => {
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        } as unknown as MockResponse;
        return res as unknown as Response;
    };

    let mockResponse: Response;
    let nextFunction: NextFunction;

    beforeEach(() => {
        mockResponse = createMockResponse();
        nextFunction = jest.fn();
    });

    it('should validate and transform request data with full type safety', () => {
        const schema = {
            query: z.object({
                id: z.string().transform(val => parseInt(val, 10)),
            }),
            body: z.object({
                active: z.boolean(),
            }),
        } satisfies RequestSchemaObject;

        const reqMock: DeepPartial<InferReq<typeof schema>> = {
            query: { id: '456' },
            body: { active: true },
            params: {},
            headers: {},
            validated: {} as InferReq<typeof schema>['validated'],
        };

        const req = reqMock as InferReq<typeof schema>;
        const middleware = validateRequestMiddleware(schema);
        middleware(req as Request, mockResponse, nextFunction);

        expect(nextFunction).toHaveBeenCalled();
        expect(req.validated.query.id).toBe(456);
        expect(req.validated.body.active).toBe(true);
    });

    it('should return 400 with detailed error objects (message and code)', () => {
        const schema = {
            body: z.object({
                email: z.string().email(),
            }),
        } satisfies RequestSchemaObject;

        const reqMock: DeepPartial<InferReq<typeof schema>> = {
            body: { email: 'not-an-email' },
            params: {},
            query: {},
            headers: {},
            validated: {} as InferReq<typeof schema>['validated'],
        };

        const middleware = validateRequestMiddleware(schema);
        middleware(reqMock as Request, mockResponse, nextFunction);

        expect(mockResponse.status).toHaveBeenCalledWith(400);
        expect(mockResponse.json).toHaveBeenCalledWith({
            errors: {
                body: {
                    email: [
                        {
                            message: 'Invalid email',
                            code: 'invalid_string',
                        },
                    ],
                },
            },
        });
    });

    it('should prioritize custom error codes provided via Zod params', () => {
        const rangeSchema = z
            .object({
                from: z.number(),
                to: z.number(),
            })
            .refine(data => data.to > data.from, {
                // eslint-disable-next-line quotes
                message: "The 'to' value must be greater than 'from'",
                path: ['to'],
                params: { code: 'RANGE_TO_GTE_FROM' },
            });

        const schema = {
            body: z.object({
                range: rangeSchema,
            }),
        } satisfies RequestSchemaObject;

        const reqMock: DeepPartial<InferReq<typeof schema>> = {
            body: {
                range: { from: 100, to: 50 },
            },
            params: {},
            query: {},
            headers: {},
            validated: {} as InferReq<typeof schema>['validated'],
        };

        const middleware = validateRequestMiddleware(schema);
        middleware(reqMock as Request, mockResponse, nextFunction);

        const responseBody = (mockResponse.json as jest.Mock).mock.calls[0][0];

        expect(responseBody.errors.body.range.to).toEqual([
            {
                // eslint-disable-next-line quotes
                message: "The 'to' value must be greater than 'from'",
                code: 'RANGE_TO_GTE_FROM',
            },
        ]);
    });

    it('should handle complex nested arrays with indices and discriminated unions', () => {
        const strategySchema = z.discriminatedUnion('type', [
            z.object({ type: z.literal('sniper'), speed: z.number() }),
            z.object({ type: z.literal('passive'), delay: z.number() }),
        ]);

        const schema = {
            body: z.object({
                strategies: z.array(strategySchema),
            }),
        } satisfies RequestSchemaObject;

        const reqMock: DeepPartial<InferReq<typeof schema>> = {
            body: {
                strategies: [
                    { type: 'sniper', speed: 100 },
                    { type: 'sniper', speed: 'fast' }, // Error at index 1
                ],
            },
            params: {},
            query: {},
            headers: {},
            validated: {} as InferReq<typeof schema>['validated'],
        };

        const middleware = validateRequestMiddleware(schema);
        middleware(reqMock as Request, mockResponse, nextFunction);

        const responseBody = (mockResponse.json as jest.Mock).mock.calls[0][0];

        // Verifying the specific index '1' is preserved as a key
        expect(responseBody.errors.body.strategies['1'].speed).toEqual([
            {
                message: expect.stringContaining('Expected number'),
                code: 'invalid_type',
            },
        ]);
    });

    it('should handle intersections (.and) across body and query', () => {
        const schema = {
            query: z.object({ page: z.string() }),
            body: z.object({ id: z.string() }).and(z.object({ meta: z.object({ tags: z.array(z.string()) }) })),
        } satisfies RequestSchemaObject;

        const reqMock: DeepPartial<InferReq<typeof schema>> = {
            query: { page: '1' },
            body: {
                id: '123',
                meta: { tags: [123] }, // Error inside deep array
            },
            params: {},
            headers: {},
            validated: {} as InferReq<typeof schema>['validated'],
        };

        const middleware = validateRequestMiddleware(schema);
        middleware(reqMock as Request, mockResponse, nextFunction);

        const responseBody = (mockResponse.json as jest.Mock).mock.calls[0][0];

        expect(responseBody.errors.body.meta.tags['0']).toEqual([
            {
                message: expect.stringContaining('Expected string'),
                code: 'invalid_type',
            },
        ]);
    });

    it('should catch non-Zod errors and pass them to next()', () => {
        const schema = {
            urlParams: z.object({
                id: z.string().refine(() => {
                    throw new Error('Database connection failed');
                }),
            }),
        } satisfies RequestSchemaObject;

        const reqMock: DeepPartial<InferReq<typeof schema>> = {
            params: { id: '1' },
            body: {},
            query: {},
            headers: {},
            validated: {} as InferReq<typeof schema>['validated'],
        };

        const middleware = validateRequestMiddleware(schema);
        middleware(reqMock as Request, mockResponse, nextFunction);

        expect(nextFunction).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Database connection failed',
            }),
        );
    });
});
