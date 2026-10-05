// readme.mjs -- a README (Markdown) to the parts a story starts from. Pure: text in, plain text out.
//
//   parseReadme(markdown) -> { title, subtitle, items: [{ label, detail?, tag: 'feature' }], install, media: [{ path, alt? }] }
//
// title: the first level-1 heading (`# x`, `x` underlined with ===, or an HTML <h1>). subtitle: the first paragraph
// of plain text after it, before the next heading (badges, images, HTML tags, <sub>/<sup>/<small> captions and lines
// of nothing but links are skipped).
// items (in README order): the top-level bullets (- * + or 1. 1)) of a section whose heading names features, "what
// it does" or highlights, else of the first top-level list; each split at the first ":", " — ", " – " or " - " into
// label and detail. install: the first line of the first sh/bash/shell/console/zsh fence (else of the first fence),
// "$ " stripped and comment lines skipped. media: every image outside fences, in order, as written (relative paths stay relative), badges left out
// (a src naming shields.io, badgen.net or "badge", or a paragraph of nothing but linked remote images).
// A bullet that is only a link to an #anchor, a URL or a .md file (a description after it or not) is navigation (a
// table of contents, a docs list), not an item; a features section without item bullets gives its sub-headings, and
// with neither gives no items (no other list stands in); a bullet led by a **bold run** takes it as the label.
// Text is cleaned of Markdown, HTML, entities and emoji (plainText(s) does the same to any line, such as a repo's
// description); a missing part is undefined (items and media are []).
//
//   parseNotes(markdown) -> { paragraph, bullets: [{ heading, text }] }    bulletItem(text) -> { label, detail?, tag } | null
//
// parseNotes reads a release or pull request body: its first paragraph of plain text (anywhere), and its top-level
// bullets as raw Markdown, each with the heading it sits under ('' before any), a GitHub credit (" by @x in URL")
// and a trailing "(#12)" removed. bulletItem is a README feature bullet's split (label, detail), for those bullets.

const SHELL = new Set(['sh', 'bash', 'shell', 'console', 'zsh', 'shell-session']);
const FEATURES = /\b(features|what it does|highlights)\b/i;
const BADGE = /shields\.io|badgen\.net|badge/i;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', copy: '©' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  }
  return ENTITIES[e.toLowerCase()] ?? m;
});

// Emoji (pictographs, flags, skin tones, joiners, variation selectors, keycaps) and :shortcode: emoji.
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}️‍⃣]/gu;
const SHORTCODE = /(^|\s):[a-z0-9_+-]*[a-z][a-z0-9_+-]*:(?=\s|$|[.,;!?])/gi;

// Inline Markdown/HTML to plain text: images dropped, links to their text, tags, code marks, emphasis and emoji
// removed, entities decoded, whitespace collapsed. dropLinks drops links whole (to see what else a line holds).
function inline(s, { dropLinks = false } = {}) {
  let t = s
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '') // a linked image (a badge)
    .replace(/\[!\[[^\]]*\]\[[^\]]*\]\]\[[^\]]*\]/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/!\[[^\]]*\]\[[^\]]*\]/g, '')
    .replace(/<img\b[^>]*>/gi, '');
  t = dropLinks
    ? t.replace(/\[[^\]]*\]\([^)]*\)/g, '').replace(/\[[^\]]*\]\[[^\]]*\]/g, '').replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, '')
    : t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1');
  t = t
    .replace(/<((?:https?|mailto):[^>\s]+)>/gi, dropLinks ? '' : '$1')
    .replace(/<(sub|sup|small)\b[^>]*>[\s\S]*?<\/\1>/gi, '') // captions and fine print
    .replace(/<\/?(p|div|br|li|ul|ol|h[1-6]|table|tr|td|th|hr|blockquote|section|picture|details|summary)\b[^>]*>/gi, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/(`+)([\s\S]*?)\1/g, '$2')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\w)/g, '$1$2')
    .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1$2')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
    .replace(SHORTCODE, '$1')
    .replace(EMOJI, '');
  return decode(t).replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
}

const HR = /^ {0,3}([-*_])( *\1){2,} *$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const ATX = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const HTML_H = /^\s*<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>\s*$/i;
const BULLET = /^( *)(?:[-*+]|\d{1,9}[.)])\s+(.*)$/; // a bullet or a numbered item

// The README as blocks: heading { level, text }, para { lines }, bullet { indent, text }, fence { lang, lines },
// blank. HTML comments are removed first.
function blocks(md) {
  const out = [];
  const lines = md.replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n?/g, '\n').split('\n');
  const last = () => out[out.length - 1];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\t/g, '    ');
    const fence = FENCE.exec(line);
    if (fence) {
      const close = new RegExp(`^ {0,3}${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`);
      const body = [];
      while (++i < lines.length && !close.test(lines[i])) body.push(lines[i]);
      out.push({ type: 'fence', lang: fence[2].toLowerCase(), lines: body });
      continue;
    }
    if (line.trim() === '' || HR.test(line)) {
      if (last()?.type === 'para' && /^ {0,3}-+\s*$/.test(line) && last().lines.length === 1) {
        out[out.length - 1] = { type: 'heading', level: 2, text: last().lines[0] }; // setext
      } else out.push({ type: 'blank' });
      continue;
    }
    if (last()?.type === 'para' && /^ {0,3}=+\s*$/.test(line) && last().lines.length === 1) {
      out[out.length - 1] = { type: 'heading', level: 1, text: last().lines[0] };
      continue;
    }
    const h = ATX.exec(line) ?? HTML_H.exec(line);
    if (h) { out.push({ type: 'heading', level: h[1][0] === '#' ? h[1].length : Number(h[1]), text: h[2] ?? '' }); continue; }
    const b = BULLET.exec(line);
    if (b) { out.push({ type: 'bullet', indent: b[1].length, text: b[2] }); continue; }
    // a line straight after a bullet continues it; after a paragraph line, the paragraph
    if (last()?.type === 'bullet') last().text += ` ${line.trim()}`;
    else if (last()?.type === 'para') last().lines.push(line);
    else out.push({ type: 'para', lines: [line] });
  }
  return out;
}

// A bullet that is only a link to an #anchor, an absolute URL or a Markdown file, with or without a description
// after a separator: navigation (a table of contents, a docs list), not a feature.
const NAV_LINK = /^\[[^\]]*\]\(\s*<?(?:#[^)\s>]*|[a-z][a-z0-9+.-]*:[^)\s>]*|[^)\s>]*\.md(?:#[^)\s>]*)?)>?(?:\s+"[^"]*")?\s*\)\s*(?:$|[:—–-])/i;
const BOLD_LEAD = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1\s*([\s\S]*)$/;

// A bullet as an item: a leading bold run is the label; else label and detail split at the first separator (when
// both sides have text). null for a navigation link or an empty bullet.
function item(raw) {
  const r = raw.replace(/^\[[ xX]\]\s+/, '');
  if (NAV_LINK.test(r.replace(/^(\*\*|__)(\[[\s\S]*?\))\1/, '$2'))) return null;
  const bold = BOLD_LEAD.exec(r);
  if (bold) {
    const label = inline(bold[2]).replace(/[\s:—–-]+$/, '');
    const detail = inline(bold[3]).replace(/^[:—–-]\s*/, '');
    if (label) return detail ? { label, detail, tag: 'feature' } : { label, tag: 'feature' };
  }
  const text = inline(r);
  if (!text) return null;
  let at = -1, len = 0;
  for (const sep of [':', ' — ', ' – ', ' - ']) {
    let i = text.indexOf(sep);
    while (sep === ':' && i >= 0 && text.startsWith('//', i + 1)) i = text.indexOf(sep, i + 1); // not in a URL
    if (i > 0 && (at < 0 || i < at)) { at = i; len = sep.length; }
  }
  const label = at > 0 ? text.slice(0, at).trim() : text;
  const detail = at > 0 ? text.slice(at + len).trim() : '';
  return detail && label ? { label, detail, tag: 'feature' } : { label: text, tag: 'feature' };
}

export const bulletItem = item;
export const plainText = (s) => inline(String(s ?? ''));

const TOP = 2; // a bullet indented less than this is top level

// The features section's top-level bullets; with none that are items, its sub-headings (label) and the first
// paragraph under each (detail); with neither, none (never another section's list). With no features section, the
// first top-level bullet list in the README.
function items(bs) {
  const at = bs.findIndex((b) => b.type === 'heading' && FEATURES.test(inline(b.text)));
  if (at >= 0) {
    const bullets = [], subs = [];
    for (let i = at + 1; i < bs.length; i++) {
      const b = bs[i];
      if (b.type === 'heading' && b.level <= bs[at].level) break;
      if (b.type === 'bullet' && b.indent < TOP) bullets.push(b);
      if (b.type === 'heading') {
        if (inline(b.text)) subs.push({ label: inline(b.text), detail: '' });
      } else if (b.type === 'para' && subs.length && !subs.at(-1).detail) subs.at(-1).detail = inline(b.lines.join('\n'));
    }
    const found = bullets.map((b) => item(b.text)).filter(Boolean);
    if (found.length) return found;
    return subs.map(({ label, detail }) => (detail ? { label, detail, tag: 'feature' } : { label, tag: 'feature' }));
  }
  const start = bs.findIndex((b) => b.type === 'bullet' && b.indent < TOP);
  if (start < 0) return [];
  const found = [];
  for (let i = start; i < bs.length && (bs[i].type === 'bullet' || bs[i].type === 'blank'); i++) {
    if (bs[i].type === 'bullet' && bs[i].indent < TOP) found.push(bs[i]);
  }
  return found.map((b) => item(b.text)).filter(Boolean);
}

function install(bs) {
  const fences = bs.filter((b) => b.type === 'fence');
  for (const f of [...fences.filter((f) => SHELL.has(f.lang)), ...fences]) {
    for (const l of f.lines) {
      const line = l.trim().replace(/^\$\s+/, '');
      if (line && !/^#(\s|!|$)/.test(line)) return line; // "# a comment", "#!/bin/sh" and a lone "#" are skipped
    }
  }
  return undefined;
}

const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
};

// A paragraph of nothing but linked remote images ([![x](https://...)](...) or <a><img src="https://..."></a>): a
// row of badges, whatever their host.
function badgeRow(raw) {
  const srcs = [];
  const rest = raw
    .replace(/\[!\[[^\]]*\]\(\s*<?([^\s)>]+)[^)]*\)\]\([^)]*\)/g, (m, src) => { srcs.push(src); return ''; })
    .replace(/<a\b[^>]*>\s*(<img\b[^>]*>)\s*<\/a>/gi, (m, img) => { srcs.push(attr(img, 'src') ?? ''); return ''; });
  if (!srcs.length || /!\[|<img\b/i.test(rest) || /[\p{L}\p{N}]/u.test(inline(rest))) return false;
  return srcs.every((s) => /^https?:\/\//i.test(s));
}

function media(bs) {
  const seen = new Set(), out = [];
  const lines = bs.flatMap((b) => (b.type === 'para' ? (badgeRow(b.lines.join('\n')) ? [] : b.lines)
    : b.type === 'bullet' || b.type === 'heading' ? [b.text] : []));
  for (const line of lines) {
    const found = [];
    for (const m of line.matchAll(/!\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+[^)]*)?\)/g)) found.push({ at: m.index, path: m[2], alt: m[1] });
    for (const m of line.matchAll(/<img\b[^>]*>/gi)) found.push({ at: m.index, path: attr(m[0], 'src'), alt: attr(m[0], 'alt') });
    for (const f of found.sort((a, b) => a.at - b.at)) {
      if (!f.path || BADGE.test(f.path) || seen.has(f.path)) continue;
      seen.add(f.path);
      const alt = f.alt == null ? '' : inline(f.alt);
      out.push(alt ? { path: f.path, alt } : { path: f.path });
    }
  }
  return out;
}

export function parseReadme(markdown) {
  const bs = blocks(markdown);
  const h1 = bs.findIndex((b) => b.type === 'heading' && b.level === 1 && inline(b.text));
  let subtitle;
  for (let i = h1 + 1; i < bs.length && bs[i].type !== 'heading'; i++) {
    if (bs[i].type !== 'para') continue;
    subtitle = prose(bs[i]); // tables, badges, images and rows of links are not prose
    if (subtitle !== undefined) break;
  }
  return {
    title: h1 >= 0 ? inline(bs[h1].text) : undefined,
    subtitle,
    items: items(bs),
    install: install(bs),
    media: media(bs),
  };
}

// A paragraph's plain text, or undefined for one of nothing but badges, images or links, or a table.
function prose(b) {
  if (/^\s*\|/.test(b.lines[0])) return undefined;
  const raw = b.lines.map((l) => l.replace(/^\s*>\s?/, '')).join('\n');
  return /[\p{L}\p{N}]/u.test(inline(raw, { dropLinks: true })) ? inline(raw) : undefined;
}

export function parseNotes(markdown) {
  let paragraph, heading = '';
  const bullets = [];
  for (const b of blocks(markdown ?? '')) {
    if (b.type === 'heading') heading = inline(b.text);
    else if (b.type === 'para') paragraph ??= prose(b);
    else if (b.type === 'bullet' && b.indent < TOP) {
      const text = b.text.replace(/\s+by\s+@[\w.-]+(?:\[bot\])?\s+in\s+\S+\s*$/i, '').replace(/\s*\((?:#\d+(?:,\s*#\d+)*)\)\s*$/, '').trim();
      if (text) bullets.push({ heading, text });
    }
  }
  return { paragraph, bullets };
}
