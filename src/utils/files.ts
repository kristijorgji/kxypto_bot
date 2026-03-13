import * as fs from 'fs';
import { createHash } from 'node:crypto';
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

export interface FileInfo {
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

export async function copyFile(source: string, destination: string): Promise<void> {
    // Resolve absolute paths to prevent "same file" data loss
    const srcPath = path.resolve(source);
    const destPath = path.resolve(destination);

    if (srcPath === destPath) return;

    const destDir = path.dirname(destPath);
    fs.mkdirSync(destDir, { recursive: true });

    await fs.promises.copyFile(srcPath, destPath);
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

/**
 * Ensures a file path is safe for the operating system (macOS/Windows/Linux).
 * If any directory segment exceeds 255 bytes or the total path length
 * exceeds OS limits, it hashes the offending parts to prevent ENAMETOOLONG.
 */
export function getSafePath(fullPath: string): string {
    const isWindows = process.platform === 'win32';
    const MAX_SEGMENT_BYTES = 255;
    const MAX_TOTAL_LENGTH = isWindows ? 250 : 4000;

    // 1. Resolve to absolute so we handle ./ relative paths
    let absolutePath = path.resolve(fullPath);

    // 2. Split path into segments (works for both / and \)
    const parts = absolutePath.split(path.sep);

    // 3. Process each segment individually
    const safeParts = parts.map(part => {
        if (Buffer.byteLength(part, 'utf8') > MAX_SEGMENT_BYTES) {
            const hash = createHash('md5').update(part).digest('hex').slice(0, 10);
            const prefix = part.substring(0, 30).replace(/[^a-z0-9]/gi, '_');
            return `${prefix}_${hash}`;
        }
        return part;
    });

    // Reconstruct the path
    let resultPath = safeParts.join(path.sep);

    // 4. Final check: Is the TOTAL path still too long? (Windows Specific)
    if (resultPath.length > MAX_TOTAL_LENGTH) {
        // If still too long, we hash the last few segments to force it under limit
        const dir = path.dirname(resultPath);
        const base = path.basename(resultPath);
        const hash = createHash('md5').update(base).digest('hex').slice(0, 10);
        resultPath = path.join(dir, hash);
    }

    return resultPath;
}
