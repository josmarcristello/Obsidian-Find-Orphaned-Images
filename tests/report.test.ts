import { describe, it, expect } from 'vitest';
import type { TFile } from 'obsidian';
import { buildReport } from '../report';

// Minimal TFile-shaped stub — buildReport only reads path, parent.path, and stat.size.
function img(path: string, size: number): TFile {
    const slash = path.lastIndexOf('/');
    const parent = slash === -1 ? null : { path: path.slice(0, slash) };
    return { path, parent, stat: { size } } as unknown as TFile;
}

describe('buildReport', () => {
    it('summarises count and total reclaimable size', () => {
        const report = buildReport([img('a/x.png', 1024), img('a/y.png', 1024)], false);
        expect(report).toContain('These 2 images are not linked in any note — 2.0 KB reclaimable.');
    });

    it('uses singular grammar for a single image', () => {
        const report = buildReport([img('x.png', 512)], false);
        expect(report).toContain('These 1 image is not linked');
    });

    it('groups by folder with per-folder headings and sizes', () => {
        const report = buildReport([img('a/x.png', 1024), img('b/y.png', 2048)], false);
        expect(report).toContain('## a — 1 image, 1.0 KB');
        expect(report).toContain('## b — 1 image, 2.0 KB');
    });

    it('labels vault-root images', () => {
        const report = buildReport([img('root.png', 512)], false);
        expect(report).toContain('## (vault root) — 1 image, 512 B');
    });

    it('emits wikilinks (not markdown) so special chars resolve', () => {
        const textReport = buildReport([img('a/my #1.png', 100)], false);
        expect(textReport).toContain('- [[a/my #1.png]] — 100 B');

        const embedReport = buildReport([img('a/my #1.png', 100)], true);
        expect(embedReport).toContain('- ![[a/my #1.png]] — 100 B');
    });

    it('sorts folders alphabetically', () => {
        const report = buildReport([img('z/a.png', 1), img('a/b.png', 1)], false);
        expect(report.indexOf('## a ')).toBeLessThan(report.indexOf('## z '));
    });
});
