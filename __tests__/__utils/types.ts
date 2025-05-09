export type FullTestExpectation = {
    fnsCallArgs: Record<string, unknown[]>;
    result: unknown;
    logs: unknown[];
};
