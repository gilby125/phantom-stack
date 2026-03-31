/**
 * Parser and transformer for rich `<image>` and `<file>` component tags.
 *
 * Agents can write `<image path="./chart.png" alt="Chart" />` or
 * `<file path="./report.pdf" name="Report" />` in their markdown output.
 * These are pre-processed into markdown-compatible syntax before being
 * rendered by react-markdown.
 */

// Matches self-closing <image .../> and <file .../> tags
const TAG_RE = /<(image|file)\s+([^>]*?)\s*\/>/gi;

// Matches a partial (unclosed) tag at the end of streaming content
const PARTIAL_TAG_RE = /<(?:image|file)(?:\s+[^>]*)?$/i;

interface RichTag {
  type: "image" | "file";
  path: string;
  alt?: string;
  name?: string;
}

/** Extract attribute values from a tag's attribute string. */
function parseAttrs(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /(\w+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(attrStr)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

/** Parse all rich tags from content, returning structured metadata. */
export function parseRichTags(content: string): RichTag[] {
  const tags: RichTag[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(TAG_RE.source, TAG_RE.flags);
  while ((m = re.exec(content)) !== null) {
    const tagType = m[1].toLowerCase() as "image" | "file";
    const attrs = parseAttrs(m[2]);
    if (!attrs.path) continue;
    tags.push({
      type: tagType,
      path: attrs.path,
      alt: attrs.alt,
      name: attrs.name,
    });
  }
  return tags;
}

/**
 * Replace rich tags with markdown-compatible syntax:
 * - `<image path="p" alt="a" />` → `![a](sandboxed-image://p)`
 * - `<file path="p" name="n" />`  → `[n](sandboxed-file://p)`
 *
 * Paths are URI-encoded to handle spaces and special characters.
 */
export function transformRichTags(content: string): string {
  return content.replace(TAG_RE, (_match, tagType: string, attrStr: string) => {
    const attrs = parseAttrs(attrStr);
    if (!attrs.path) return _match; // leave malformed tags as-is
    const encodedPath = encodeURIComponent(attrs.path);
    if (tagType.toLowerCase() === "image") {
      const alt = attrs.alt || attrs.path.split("/").pop() || "image";
      return `![${alt}](sandboxed-image://${encodedPath})`;
    } else {
      const name = attrs.name || attrs.path.split("/").pop() || "file";
      return `[${name}](sandboxed-file://${encodedPath})`;
    }
  });
}

/**
 * Detect an incomplete rich tag at the end of streaming content.
 * Returns true if the content ends with something like `<image path="foo`
 * (no closing `/>` yet).
 */
export function hasPartialRichTag(content: string): boolean {
  return PARTIAL_TAG_RE.test(content);
}
