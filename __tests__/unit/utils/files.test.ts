import { comparePaths } from '../../../src/utils/files';

jest.mock('os', () => ({
    ...jest.requireActual('os'),
    platform: jest.fn(() => 'win32'),
}));

describe(comparePaths.name, () => {
    it('should return true for equivalent paths (same file)', () => {
        const path1 = 'data/pumpfun-stats/1.00/1.json';
        const path2 = './data/pumpfun-stats/1.00/1.json';

        expect(comparePaths(path1, path2)).toBe(true);
    });

    it('should return true for equivalent paths (with different relative formats)', () => {
        const path1 = 'data/./pumpfun-stats/1.00/1.json';
        const path2 = './data/pumpfun-stats/1.00/1.json';

        expect(comparePaths(path1, path2)).toBe(true);
    });

    it('should return false for different files', () => {
        const path1 = 'data/pumpfun-stats/1.00/1.json';
        const path2 = 'data/pumpfun-stats/1.00/2.json';

        expect(comparePaths(path1, path2)).toBe(false);
    });

    it('should return false for different directories', () => {
        const path1 = 'data/pumpfun-stats/1.00/1.json';
        const path2 = 'data/pumpfun-stats/2.00/1.json';

        expect(comparePaths(path1, path2)).toBe(false);
    });

    it('should return true for same paths with different directory separators on Windows', () => {
        const path1 = 'data\\pumpfun-stats\\1.00\\1.json';
        const path2 = './data/pumpfun-stats/1.00/1.json';

        // On Windows, paths with forward slashes or backslashes should be considered equal
        expect(comparePaths(path1, path2)).toBe(true);
    });

    it('should handle case-insensitive file systems correctly (e.g., Windows)', () => {
        const path1 = './data/Pumpfun-stats/1.00/1.json';
        const path2 = './data/pumpfun-stats/1.00/1.json';

        // Windows is case-insensitive, so it should return true
        expect(comparePaths(path1, path2)).toBe(true);
    });

    it('should return false for paths on different file systems', () => {
        const path1 = '/mnt/data/pumpfun-stats/1.00/1.json';
        const path2 = 'C:/data/pumpfun-stats/1.00/1.json';

        // Different file systems should not be considered equal
        expect(comparePaths(path1, path2)).toBe(false);
    });
});
