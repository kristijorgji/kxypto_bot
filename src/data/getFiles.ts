import { DataSource } from '@src/core/types';
import { FileInfo, walkDirFilesSyncRecursive } from '@src/utils/files';

export function getFiles(dataConfig: DataSource, extension: string | null = 'json'): FileInfo[] {
    let files = walkDirFilesSyncRecursive(dataConfig.path, [], extension);
    if (dataConfig.includeIfPathContains) {
        files = files.filter(el =>
            dataConfig.includeIfPathContains!.some(substring => el.fullPath.includes(substring)),
        );
    }

    return files;
}
