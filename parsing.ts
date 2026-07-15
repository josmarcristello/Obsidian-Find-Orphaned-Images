// Pure text extraction for reference sources Obsidian doesn't index. Each returns raw
// targets; the caller resolves them against the vault (ReferenceScanner.addResolvedRef).

// Embed targets: wiki (![[target]]) and markdown (![](target)). Strips wiki
// aliases/anchors; decodes percent-encoding in markdown URLs.
export function extractEmbeds(text: string): string[] {
    const targets: string[] = [];

    for (const match of text.matchAll(/!\[\[([^\]|#]+)[^\]]*\]\]/g)) {
        targets.push(match[1].trim());
    }
    for (const match of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const raw = match[1].trim();
        try {
            targets.push(decodeURIComponent(raw));
        } catch {
            targets.push(raw);
        }
    }

    return targets;
}

// <img src="..."> targets. Skips anything with a URI scheme (http:, data:, …) since it
// can't be a vault path, and strips a leading "./" or "/".
export function extractImgSrcs(content: string): string[] {
    const srcs: string[] = [];

    for (const match of content.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
        const src = match[1].trim();
        if (/^[a-z][a-z0-9+.-]*:/i.test(src)) continue; // URL scheme, not a vault path
        let path = src;
        try {
            path = decodeURIComponent(src);
        } catch { /* keep raw */ }
        srcs.push(path.replace(/^\.?\//, ''));
    }

    return srcs;
}

// Embeds inside legacy Admonitions blocks (```ad-note … ![[img]] … ```), which Obsidian
// renders but never resolves. Only ad-* fences are scanned; plain code blocks are ignored.
export function extractAdmonitionEmbeds(content: string): string[] {
    const targets: string[] = [];

    for (const block of content.matchAll(/(`{3,}|~{3,})[ \t]*ad-[\w-]+[^\n]*\n([\s\S]*?)\r?\n\1/gi)) {
        targets.push(...extractEmbeds(block[2]));
    }

    return targets;
}
