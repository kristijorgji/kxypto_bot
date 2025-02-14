import * as fs from 'fs';
import * as os from 'os';
import path from 'path';

import * as bigJson from 'big-json';

/**
 * For big files
 */
export function readStreamAsBuffer(filePath: string): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
        const stream = fs.createReadStream(filePath);
        const chunks: Buffer[] = [];

        stream.on('data', chunk => {
            chunks.push(chunk as Buffer);
        });

        stream.on('end', () => {
            const completeBuffer = Buffer.concat(chunks);
            resolve(completeBuffer);
        });

        stream.on('error', err => {
            reject(err);
        });
    });
}

/**
 * NodeJS max string length is 512mb so for bigger parsing we need streams
 */
export function readBigJson<T>(filePath: string): Promise<T> {
    const readStream = fs.createReadStream(filePath);
    const parseStream = bigJson.createParseStream();

    return new Promise((resolve, reject) => {
        parseStream.on('data', function (pojo) {
            resolve(pojo);
        });

        parseStream.on('error', function (err) {
            reject(err);
        });

        readStream.pipe(parseStream);
    });
}

interface FileInfo {
    name: string;
    fullPath: string;
    creationTime: Date;
}

export function walkDirFilesSyncRecursive(
    dir: string,
    fileList: FileInfo[] = [],
    extension: string | null = null,
): FileInfo[] {
    dir = normalizeDirName(dir);

    const files = fs.readdirSync(dir);
    const extPattern = extension ? new RegExp(`.*.${extension}$`, 'i') : null;

    files.forEach(file => {
        const fullPath = path.join(dir, file);

        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
            walkDirFilesSyncRecursive(fullPath + '/', fileList, extension);
        } else {
            if (!extension || extPattern?.test(file)) {
                fileList.push({
                    name: file,
                    fullPath: fullPath,
                    creationTime: stats.birthtime,
                });
            }
        }
    });

    return fileList;
}

/**
 * Normalizes the directory name by ensuring it ends with a separator.
 */
function normalizeDirName(dir: string): string {
    return dir.endsWith(path.sep) ? dir : dir + path.sep;
}

export async function moveFile(source: string, destination: string): Promise<void> {
    const destDir = path.dirname(destination);
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }

    await fs.promises.rename(source, destination);
}

export function comparePaths(path1: string, path2: string): boolean {
    // Normalize and resolve both paths
    let normalizedPath1 = path.resolve(path1).replace(/\\/g, '/'); // Convert Windows backslashes to forward slashes
    let normalizedPath2 = path.resolve(path2).replace(/\\/g, '/');

    // On Windows, compare paths in a case-insensitive manner
    if (os.platform() === 'win32') {
        normalizedPath1 = normalizedPath1.toLowerCase();
        normalizedPath2 = normalizedPath2.toLowerCase();
    }

    return normalizedPath1 === normalizedPath2;
}
