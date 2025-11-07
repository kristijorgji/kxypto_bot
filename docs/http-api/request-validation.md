# ✅ Request Validation & Typed Handlers (Zod + Express 4/5)

## 📑 Table of Contents

- [Why this system exists](#-why-this-system-exists)
- [1. Defining Zod Schemas](#-1-defining-zod-schemas)
- [2. The validateRequestMiddleware](#-2-the-validaterequestmiddleware)
- [3. Typed Request Object: InferReq](#-3-typed-request-object-inferreqs)
- [4. Typed Handlers using createTypedHandler](#-4-typed-handlers-using-createtypedhandler)
- [5. How to Use in a Route](#-5-how-to-use-in-a-route)
- [Summary](#-summary)

This backend uses a fully typed, runtime-validated, and Express-compatible approach for handling request input.  
The system ensures:

- Runtime validation (Zod)
- Static type inference for route handlers
- Works in Express 4 and Express 5
- No mutation of Express’ internal request fields (`req.query`, `req.params`, etc.)
- All validated values stored in a safe `req.validated` object
- Zero runtime overhead from TypeScript helpers

## 🔍 Why this system exists

Express (especially Express 5) treats:

- `req.params`
- `req.query`
- `req.headers`
- sometimes even `req.body`

as read-only getters or proxy objects.

This makes it unsafe or impossible to assign parsed/validated data back into them.

Therefore, we never modify Express request internals.

Instead, we attach a typed, safe object:

```
req.validated
```

This becomes the single source of truth for all request data.

## ✅ 1. Defining Zod Schemas

```ts
export const deleteStrategyResultByIdRequestSchema = {
    urlParams: z.object({
        id: z.coerce.number().int().positive(),
    }),
} satisfies RequestSchemaObject;
```

We use `satisfies RequestSchemaObject` so TypeScript:

- checks correctness
- keeps full literal type inference

## ✅ 2. The `validateRequestMiddleware`

This middleware:

1. Reads raw Express request data
2. Validates each part (`body`, `query`, `urlParams`, `headers`)
3. Writes parsed values into `req.validated.<section>`
4. Aggregates errors into a single response
5. Avoids touching read-only Express fields

Example error response:

```
{
  "errors": {
    "urlParams": { "id": ["Invalid number"] },
    "query": { "limit": ["Limit must be >= 1"] }
  }
}
```

Supports Zod refinements, superRefine(), transforms, and works with Express 4 & 5.

## ✅ 3. Typed Request Object: `InferReq<S>`

```ts
export async function deleteStrategyResultByIdHandler(
    req: InferReq<typeof deleteStrategyResultByIdRequestSchema>,
    res: Response
) {
    const { id } = req.validated.urlParams;
    await deleteBacktestStrategyById(id);
    res.sendStatus(200);
}
```

Everything inside `req.validated` is strongly typed.

## ✅ 4. Typed Handlers using `createTypedHandler`

```ts
createTypedHandler(handler)
```

Usage:

```ts
app.delete(
    "/backtest-strategy-result/:id",
    validateRequestMiddleware(deleteStrategyResultByIdRequestSchema),
    createTypedHandler(deleteStrategyResultByIdHandler)
);
```

## ✅ 5. How to Use in a Route

```ts
const querySchema = z.object({
    limit: z.coerce.number().min(1).max(100).default(10),
    cursor: z.string().optional(),
});

const schema = {
    urlParams: z.object({ id: z.number() }),
    query: querySchema,
} satisfies RequestSchemaObject;

app.get(
    "/items/:id",
    validateRequestMiddleware(schema),
    createTypedHandler(async (req, res) => {
        const { id } = req.validated.urlParams;
        const { limit, cursor } = req.validated.query;
        res.json({ id, limit, cursor });
    })
);
```

# ✅ Summary

This validation system provides:

### Runtime safety (Zod)

- Full data validation
- Aggregated, structured error responses
- Support for refinements & transforms

### Static type safety (TypeScript)

- Route handlers automatically receive typed request data
- Typed `req.validated` for body/query/params/headers
- Single source of truth

### Express compatibility

- Does not mutate read-only fields
- Zero-overhead typed handler adapter
- Clean and predictable flow

### Simple and ergonomic

- Define schemas once
- Get runtime validation + static typing for free
