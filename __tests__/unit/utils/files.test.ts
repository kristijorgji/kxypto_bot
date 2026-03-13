import path from 'path';

import { comparePaths, getSafePath } from '../../../src/utils/files';

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

describe('getSafePath', () => {
    const originalPlatform = process.platform;

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    test('should return absolute path for normal short paths', () => {
        const normalPath = 'data/stats/short';
        const result = getSafePath(normalPath);
        expect(result).toBe(path.resolve(normalPath));
    });

    test('should shorten a middle directory that is > 255 bytes', () => {
        const longMiddle = 'a'.repeat(300);
        const endPart = 'dumped';
        const complexPath = path.join('data', longMiddle, endPart);

        const result = getSafePath(complexPath);
        const parts = result.split(path.sep);

        // Find the segment that was originally longMiddle
        const shortenedSegment = parts.find(p => p.startsWith('a'.repeat(30)));

        expect(shortenedSegment).toBeDefined();
        expect(Buffer.byteLength(shortenedSegment!, 'utf8')).toBeLessThan(255);
        expect(shortenedSegment).toMatch(/[a-z0-9]{30}_[a-f0-9]{10}/);
        expect(result.endsWith(endPart)).toBe(true);
    });

    test('should sanitize special characters in the prefix of long names', () => {
        const longSpecial = 'e_ag:recency(weighted)_' + 'b'.repeat(250);
        const result = getSafePath(longSpecial);
        const fileName = path.basename(result);

        // Should replace : ( ) with _
        expect(fileName).toMatch(/^e_ag_recency_weighted__/);
        expect(fileName.length).toBeLessThan(255);
    });

    test('should respect Windows total path limit (250 chars)', () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });

        // Create a path so long that path.resolve() + this string
        // will definitely exceed 250 characters.
        const massivePath = path.join('data', 'subfolder', 'b'.repeat(500));

        const result = getSafePath(massivePath);

        // The function should detect the total length > 250
        // and hash the final segment to bring it down.
        expect(result.length).toBeLessThan(250);
    });

    test('should handle multiple long segments in the same path', () => {
        const long1 = 'c'.repeat(300);
        const long2 = 'd'.repeat(300);
        const complexPath = path.join('data', long1, long2);

        const result = getSafePath(complexPath);
        const parts = result.split(path.sep);

        const segment1 = parts[parts.length - 2];
        const segment2 = parts[parts.length - 1];

        expect(segment1).toMatch(/c{30}_[a-f0-9]{10}/);
        expect(segment2).toMatch(/d{30}_[a-f0-9]{10}/);
    });

    test('should not change segments that are exactly 255 bytes (edge case)', () => {
        const edgeName = 'e'.repeat(255);
        const result = getSafePath(edgeName);
        expect(path.basename(result)).toBe(edgeName);
    });

    test('should shorten segments based on bytes, not just character count', () => {
        // 150 characters, but each emoji is 4 bytes = 600 bytes total.
        // This would CRASH a standard Linux/Mac filesystem if not shortened.
        const emojiLong = '🚀'.repeat(150);
        const result = getSafePath(emojiLong);
        const fileName = path.basename(result);

        expect(Buffer.byteLength(fileName, 'utf8')).toBeLessThan(255);
        // Prefix should be empty or underscores if sanitizer stripped emojis
        expect(fileName).toMatch(/^[a-z0-9_]*_[a-f0-9]{10}$/i);
    });
});
