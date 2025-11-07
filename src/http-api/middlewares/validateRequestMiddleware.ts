import { NextFunction, Request, RequestHandler, Response } from 'express';
import { infer as InferZod, ZodError, ZodTypeAny } from 'zod';

export type RequestSchemaObject = {
    body?: ZodTypeAny;
    query?: ZodTypeAny;
    urlParams?: ZodTypeAny;
    headers?: ZodTypeAny;
};

export type InferReq<S extends RequestSchemaObject> = Request & {
    validated: {
        urlParams: S['urlParams'] extends ZodTypeAny ? InferZod<S['urlParams']> : {};
        body: S['body'] extends ZodTypeAny ? InferZod<S['body']> : {};
        query: S['query'] extends ZodTypeAny ? InferZod<S['query']> : {};
        headers: S['headers'] extends ZodTypeAny ? InferZod<S['headers']> : {};
    };
};

export function validateRequestMiddleware<S extends RequestSchemaObject>(schema: S) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const errors: Record<string, unknown> = {};

        const validated: Record<string, unknown> = {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (req as any).validated = validated;

        const parts: Array<[keyof RequestSchemaObject, ZodTypeAny | undefined, keyof InferReq<S>]> = [
            ['body', schema.body, 'body'],
            ['query', schema.query, 'query'],
            ['urlParams', schema.urlParams, 'params'],
            ['headers', schema.headers, 'headers'],
        ];

        for (const [schemaKey, zodSchema, reqKey] of parts) {
            if (!zodSchema) continue;

            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                validated[schemaKey] = zodSchema.parse((req as any)[reqKey]);
            } catch (err) {
                if (err instanceof ZodError) {
                    errors[schemaKey] = err.flatten().fieldErrors;
                } else {
                    return next(err);
                }
            }
        }

        if (Object.keys(errors).length > 0) {
            res.status(400).json({ errors });
            return;
        }

        next();
    };
}

export function createTypedHandler<S extends RequestSchemaObject>(
    handler: (req: InferReq<S>, res: Response, next: NextFunction) => void,
): RequestHandler {
    return handler as unknown as RequestHandler;
}
