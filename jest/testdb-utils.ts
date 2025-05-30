export function getTestDbName(): string {
    const testDatabaseName = process.env.DB_DATABASE as string;
    if (!testDatabaseName.startsWith('__test__')) {
        throw new Error(`Test database name must contain the prefix __test__, it is: ${testDatabaseName}`);
    }

    return testDatabaseName;
}
