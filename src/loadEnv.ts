/**
 * Loads environment variables from the root directory of the project,
 * determined by locating a marker file (default '.root') upwards from
 * the current directory. The `.env` file is expected to be in the same
 * directory as the marker file.
 *
 * This allows scripts running from arbitrary subfolders (e.g., `.scratch/`,
 * `src/`, etc.) to consistently load the environment config from the project root.
 *
 * Usage: Import this module at the very top of your entry script before other imports.
 */

import fs from 'fs';
import path from 'path';

import dotenv from 'dotenv';

const markerFile = '.root';
const envFileName = '.env';
const startDir = __dirname;

const rootDir = findRootDir(startDir, markerFile);

if (!rootDir) {
    throw new Error(`Could not find root directory (missing ${markerFile} file)`);
}

const envPath = path.join(rootDir, envFileName);

if (!fs.existsSync(envPath)) {
    throw new Error(`Could not find env file at ${envPath}`);
}

dotenv.config({ path: envPath });

/**
 * Recursively searches upwards from startDir to find the directory containing the marker file.
 * @param startDir Directory to start searching from
 * @param markerFile File name that marks the root directory (default '.root')
 * @returns The path to the root directory containing the marker file, or null if not found
 */
function findRootDir(startDir: string, markerFile = '.root'): string | null {
    let dir = startDir;

    while (true) {
        if (fs.existsSync(path.join(dir, markerFile))) {
            return dir;
        }
        const parentDir = path.dirname(dir);
        if (parentDir === dir) {
            // Reached filesystem root, stop
            return null;
        }
        dir = parentDir;
    }
}
