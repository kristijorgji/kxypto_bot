import { NextFunction, Request, RequestHandler, Response } from 'express';
import { infer as InferZod, ZodError, ZodIssue, ZodTypeAny } from 'zod';

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
                    errors[schemaKey] = formatZodIssues(err.issues);
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

export type ErrorDetail = {
    message: string;
    code: string;
};

export type NestedErrors = {
    [key: string]: ErrorDetail[] | NestedErrors;
};

export function formatZodIssues(issues: ZodIssue[]): NestedErrors {
    const root: NestedErrors = {};

    for (const issue of issues) {
        let current: Record<string, unknown> = root as Record<string, unknown>;

        for (let i = 0; i < issue.path.length; i++) {
            const pathPart = issue.path[i].toString();
            const isLast = i === issue.path.length - 1;

            if (isLast) {
                const existing = current[pathPart];
                const newError: ErrorDetail = {
                    message: issue.message,
                    code: issue.code, // e.g., 'invalid_type', 'too_small', 'custom'
                };

                if (!existing) {
                    current[pathPart] = [newError];
                } else if (Array.isArray(existing)) {
                    (existing as ErrorDetail[]).push(newError);
                }
            } else {
                if (!current[pathPart]) {
                    current[pathPart] = {} as NestedErrors;
                }
                current = current[pathPart] as Record<string, unknown>;
            }
        }
    }
    return root;
}

export function createTypedHandler<S extends RequestSchemaObject>(
    handler: (req: InferReq<S>, res: Response, next: NextFunction) => void,
): RequestHandler {
    return handler as unknown as RequestHandler;
}
