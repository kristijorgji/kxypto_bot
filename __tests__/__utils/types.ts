export type FullTestExpectation = {
    fnsCallArgs: Record<string, unknown[]>;
    result: unknown;
    logs: unknown[];
};

export type MultiCaseFixture = {
    path: string;
    case: string;
};

export type FullTestMultiCaseExpectation = Record<'default', Partial<FullTestExpectation>> &
    Record<string, Partial<FullTestExpectation>>;
