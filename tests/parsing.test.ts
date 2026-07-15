import { describe, it, expect } from 'vitest';
import { extractEmbeds, extractImgSrcs, extractAdmonitionEmbeds } from '../parsing';

describe('extractEmbeds', () => {
    it('extracts wiki embed targets', () => {
        expect(extractEmbeds('![[image.png]]')).toEqual(['image.png']);
    });

    it('strips wiki aliases and heading/block anchors', () => {
        expect(extractEmbeds('![[folder/pic.png|alt text]]')).toEqual(['folder/pic.png']);
        expect(extractEmbeds('![[pic.png#heading]]')).toEqual(['pic.png']);
        expect(extractEmbeds('![[pic.png|100x100]]')).toEqual(['pic.png']);
    });

    it('extracts markdown embed targets', () => {
        expect(extractEmbeds('![](image.png)')).toEqual(['image.png']);
        expect(extractEmbeds('![alt](sub/dir/image.png)')).toEqual(['sub/dir/image.png']);
    });

    it('decodes percent-encoding in markdown targets', () => {
        expect(extractEmbeds('![](my%20image.png)')).toEqual(['my image.png']);
    });

    it('ignores a markdown title suffix', () => {
        expect(extractEmbeds('![](image.png "a title")')).toEqual(['image.png']);
    });

    it('finds multiple embeds and preserves order', () => {
        expect(extractEmbeds('![[a.png]] text ![](b.png)')).toEqual(['a.png', 'b.png']);
    });

    it('does not treat a plain link (no leading !) as an embed', () => {
        expect(extractEmbeds('[[note]] and [text](page.md)')).toEqual([]);
    });

    it('returns empty for text with no embeds', () => {
        expect(extractEmbeds('just some prose')).toEqual([]);
    });
});

describe('extractImgSrcs', () => {
    it('extracts the src from an img tag', () => {
        expect(extractImgSrcs('<img src="pic.png">')).toEqual(['pic.png']);
    });

    it('handles single quotes and extra attributes', () => {
        expect(extractImgSrcs(`<img class="x" src='a/b.png' width="20">`)).toEqual(['a/b.png']);
    });

    it('skips external/absolute URLs', () => {
        expect(extractImgSrcs('<img src="https://example.com/x.png">')).toEqual([]);
        expect(extractImgSrcs('<img src="http://example.com/x.png">')).toEqual([]);
        expect(extractImgSrcs('<img src="data:image/png;base64,AAAA">')).toEqual([]);
    });

    it('strips a leading ./ or /', () => {
        expect(extractImgSrcs('<img src="./pic.png">')).toEqual(['pic.png']);
        expect(extractImgSrcs('<img src="/pic.png">')).toEqual(['pic.png']);
    });

    it('decodes percent-encoded local paths', () => {
        expect(extractImgSrcs('<img src="my%20pic.png">')).toEqual(['my pic.png']);
    });

    it('is case-insensitive on the tag/attribute', () => {
        expect(extractImgSrcs('<IMG SRC="pic.png">')).toEqual(['pic.png']);
    });

    it('finds multiple img tags', () => {
        expect(extractImgSrcs('<img src="a.png"><img src="b.png">')).toEqual(['a.png', 'b.png']);
    });
});

describe('extractAdmonitionEmbeds', () => {
    it('extracts embeds inside an ad- fenced block', () => {
        const md = '```ad-note\n![[inside.png]]\n```';
        expect(extractAdmonitionEmbeds(md)).toEqual(['inside.png']);
    });

    it('supports tilde fences', () => {
        const md = '~~~ad-warning\n![](inside.png)\n~~~';
        expect(extractAdmonitionEmbeds(md)).toEqual(['inside.png']);
    });

    it('ignores ordinary (non-ad) code blocks', () => {
        const md = '```js\n![[should-not-match.png]]\n```';
        expect(extractAdmonitionEmbeds(md)).toEqual([]);
    });

    it('handles multiple embeds in one block', () => {
        const md = '```ad-note\ntext ![[a.png]] more ![[b.png]]\n```';
        expect(extractAdmonitionEmbeds(md)).toEqual(['a.png', 'b.png']);
    });

    it('returns empty when there is no admonition', () => {
        expect(extractAdmonitionEmbeds('![[normal.png]]')).toEqual([]);
    });
});
