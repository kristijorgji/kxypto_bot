import fs from 'fs';
import { basename } from 'path';

import { FileInfo } from '../../src/utils/files';

export function mockGetFiles(getFiles: jest.Mock, fileToContent: Record<string, object | string>) {
    getFiles.mockReturnValue(
        Object.keys(fileToContent)
            .filter(fullPath => fullPath.includes('data/'))
            .map(fullPath => ({
                name: basename(fullPath),
                fullPath: fullPath,
                creationTime: new Date(),
            })) satisfies FileInfo[],
    );
}

export function mockFsReadFileSync(
    mockedFs: jest.Mocked<typeof fs>,
    realFs: typeof fs,
    map: Record<string, object | string>,
) {
    (mockedFs.readFileSync as jest.Mock).mockImplementation((...args) => {
        const [path] = args;
        const value = map[path];

        if (value) {
            return typeof value === 'object' ? JSON.stringify(value) : value;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return realFs.readFileSync(...(args as [any, any]));
    });
}
