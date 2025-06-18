import fs from 'fs';
import path from 'path';

/**
 * Recursively searches upwards from startDir to find the directory containing the marker file.
 * @param startDir Directory to start searching from
 * @param markerFile File name that marks the root directory (default '.root')
 * @returns The path to the root directory containing the marker file.
 * @throws If no directory containing the marker file is found.
 */
export default function findRootDir(startDir: string, markerFile = '.root'): string {
    let dir = startDir;

    while (true) {
        if (fs.existsSync(path.join(dir, markerFile))) {
            return dir;
        }

        const parentDir = path.dirname(dir);
        if (parentDir === dir) {
            throw new Error(`Could not find root directory containing '${markerFile}' starting from '${startDir}'`);
        }

        dir = parentDir;
    }
}
