// This is a conservative Markdown *source encoder*, not an HTML sanitizer.
// Never decode entities and never try to recognize/remove individual HTML tags.
// Outside our own root-level fences there can be no literal '<' or '!', so
// neither HTML nor ANY Markdown image form (inline/reference/shortcut) can start.
// Original ampersands/backslashes are shielded too: entity/escape spelling cannot
// manufacture syntax. Markdown entities become text nodes, not a second parse.
// Only pass the result to TextView.markdown, never TextView.html or an HTML parser.
const SHIELD = {
  "&": "&amp;", "<": "&lt;", "!": "&#33;", "\\": "&#92;",
  "`": "&#96;", "~": "&#126;",
};

function runEnd(text, start, char) {
  let end = start;
  while (text[end] === char) end++;
  return end;
}

function fenceStart(line) {
  // Deliberately support only unindented, top-level fences. Nested/indented
  // constructs fall back to shielded text; guessing containers is unsafe.
  const char = line[0];
  if (char !== "`" && char !== "~") return null;
  const size = runEnd(line, 0, char);
  if (size < 3) return null;
  const info = line.slice(size);
  if (char === "`" && info.includes("`")) return null;
  return { char, size, info };
}

function fenceEnd(line, fence) {
  let start = 0;
  while (start < 3 && line[start] === " ") start++;
  const end = runEnd(line, start, fence.char);
  if (end - start < fence.size) return false;
  for (let i = end; i < line.length; i++) {
    if (line[i] !== " " && line[i] !== "\t") return false;
  }
  return true;
}

function language(info) {
  // Do not forward arbitrary fence attributes/HTML to the renderer.
  let out = "";
  for (const char of info.trim()) {
    const n = char.charCodeAt(0);
    if (!((n >= 48 && n <= 57) || (n >= 65 && n <= 90) ||
          (n >= 97 && n <= 122) || char === "_" || char === "-" || char === "+")) break;
    out += char;
  }
  return out;
}

function codeBlock(lines, info) {
  const body = lines.join("\n");
  let longest = 0;
  for (let i = 0; i < body.length;) {
    if (body[i] !== "`") { i++; continue; }
    const end = runEnd(body, i, "`");
    longest = Math.max(longest, end - i);
    i = end;
  }
  const fence = "`".repeat(Math.max(3, longest + 1));
  // Blank lines and column zero force an independent block, even after a list
  // or quote. No untrusted backtick/tilde fences survive outside these blocks.
  return "\n\n" + fence + language(info) + "\n" + body +
    (body.endsWith("\n") || !body ? "" : "\n") + fence + "\n\n";
}

function literal(text) {
  // Used for sensitive inline code: display exactly as text (conservatively
  // without monospace), rather than trusting inline parsing inside link targets.
  let out = "";
  for (const char of text) out += "&#" + char.codePointAt(0) + ";";
  return out;
}

function inline(line) {
  let out = "";
  for (let i = 0; i < line.length;) {
    const char = line[i];
    if (char === "`") {
      const end = runEnd(line, i, char), size = end - i;
      let close = end;
      while (close < line.length) {
        if (line[close] !== "`") { close++; continue; }
        const next = runEnd(line, close, "`");
        if (next - close === size) break;
        close = next;
      }
      if (close < line.length) {
        let body = line.slice(end, close);
        if (body.startsWith(" ") && body.endsWith(" ") && body.trim()) body = body.slice(1, -1);
        // Keep simple code spans. Longer delimiters could become block fences;
        // sensitive spans instead use entities that cannot produce syntax.
        const sensitive = [...body].some(c => c === "<" || c === "!" || c === "&" || c === "\\");
        out += size < 3 && !sensitive ? line.slice(i, close + size) : literal(body);
        i = close + size;
        continue;
      }
      out += "&#96;".repeat(size);
      i = end;
      continue;
    }
    out += SHIELD[char] ?? char;
    i++;
  }
  return out;
}

/**
 * No dependencies, I/O, resource resolution or network access.
 * Images (including relative/reference images) and raw HTML are shown as inert
 * source text, not rendered. Headings/lists/tables/quotes and root fenced code
 * remain supported. This intentionally is not a full CommonMark implementation:
 * nested fences, multiline/sensitive inline code and strikethrough may degrade
 * to literal text. Do not remove the shielding to improve Markdown fidelity.
 */
export function safeMarkdown(text) {
  const lines = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const fence = fenceStart(lines[i]);
    if (!fence) {
      out.push(inline(lines[i]));
      continue;
    }
    const body = [];
    while (++i < lines.length && !fenceEnd(lines[i], fence)) body.push(lines[i]);
    out.push(codeBlock(body, fence.info));
  }
  return out.join("\n");
}
