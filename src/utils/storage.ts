import fs from 'fs';
import path from 'path';

import { storageConfig } from '../config/storage';

export function formDataFolder(relPath: string): string {
    return `${storageConfig.dataPath}/${relPath}`;
}

/**
 * It creates the folder for storing the data and returns the file name
 */
export function ensureDataFolder(relPath: string): string {
    const fullPath = `${storageConfig.dataPath}/${relPath}`;
    let dirName = relPath;

    if (isFilePath(fullPath)) {
        dirName = `${storageConfig.dataPath}/${path.dirname(relPath)}`;
    }

    if (!fs.existsSync(dirName)) {
        fs.mkdirSync(dirName, { recursive: true });
    }

    return fullPath;
}

function isFilePath(filePath: string): boolean {
    const extension = path.extname(filePath);
    return extension.length > 0;
}
