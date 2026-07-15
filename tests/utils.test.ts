import { describe, it, expect } from 'vitest';
import { formatBytes, totalSize, parseFolderList, isInFolder } from '../utils';

describe('formatBytes', () => {
    it('returns "0 B" for zero or negative', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(-5)).toBe('0 B');
    });

    it('formats bytes without decimals', () => {
        expect(formatBytes(512)).toBe('512 B');
    });

    it('formats KB/MB/GB with one decimal', () => {
        expect(formatBytes(1024)).toBe('1.0 KB');
        expect(formatBytes(1536)).toBe('1.5 KB');
        expect(formatBytes(90177536)).toBe('86.0 MB');
        expect(formatBytes(1024 ** 3)).toBe('1.0 GB');
    });

    it('caps the unit at TB', () => {
        expect(formatBytes(1024 ** 5)).toBe('1024.0 TB');
    });
});

describe('totalSize', () => {
    it('sums stat.size across files', () => {
        const files = [{ stat: { size: 10 } }, { stat: { size: 32 } }];
        expect(totalSize(files)).toBe(42);
    });

    it('returns 0 for an empty list', () => {
        expect(totalSize([])).toBe(0);
    });
});

describe('parseFolderList', () => {
    it('splits on newlines and commas', () => {
        expect(parseFolderList('a\nb, c')).toEqual(['a', 'b', 'c']);
    });

    it('trims, lowercases, and strips surrounding slashes', () => {
        expect(parseFolderList('  /Attachments/Temp/  ')).toEqual(['attachments/temp']);
    });

    it('drops empty entries', () => {
        expect(parseFolderList('a\n\n,,\nb')).toEqual(['a', 'b']);
    });

    it('returns empty for blank input', () => {
        expect(parseFolderList('   ')).toEqual([]);
    });
});

describe('isInFolder', () => {
    it('matches the folder itself', () => {
        expect(isInFolder('assets', 'assets')).toBe(true);
    });

    it('matches a subpath', () => {
        expect(isInFolder('assets/img/a.png', 'assets')).toBe(true);
    });

    it('is case-insensitive on the path', () => {
        expect(isInFolder('Assets/A.png', 'assets')).toBe(true);
    });

    it('does not match a sibling with a shared prefix', () => {
        expect(isInFolder('assets-backup/a.png', 'assets')).toBe(false);
    });

    it('does not match an unrelated folder', () => {
        expect(isInFolder('notes/a.png', 'assets')).toBe(false);
    });
});
