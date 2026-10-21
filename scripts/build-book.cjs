// The book's Markdown remains the source of truth. No network or AI is used.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const MarkdownIt = require('markdown-it');
const { decodeHTML } = require('entities');
const md = new MarkdownIt({ html: true });
const root = path.resolve(__dirname, '..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const languages = [
  { code: 'method', title: 'Введение и метод', flag: '🌱', folder: null },
  { code: 'scheme', title: 'Общая схема', flag: '🧭', folder: 'standart' },
  { code: 'en', title: 'Английский', flag: '🇬🇧', folder: '1 English' },
  { code: 'de', title: 'Немецкий', flag: '🇩🇪', folder: '2 German' },
  { code: 'it', title: 'Итальянский', flag: '🇮🇹', folder: '3 Italian' },
  { code: 'fr', title: 'Французский', flag: '🇫🇷', folder: '4 French' },
  { code: 'es', title: 'Испанский', flag: '🇪🇸', folder: '5 Spanish' },
  { code: 'ru', title: 'Русский', flag: '🇷🇺', folder: '6 Russian' },
  { code: 'kz', title: 'Казахский', flag: '🇰🇿', folder: '7 Kazakh' },
];
function htmlToMarkdown(html) {
  return decodeHTML(html.replace(/<br\s*\/?\s*>/gi, '\n\n')
    .replace(/<\/(?:p|div|li)>/gi, '\n\n').replace(/<(?:strong|b)\b[^>]*>/gi, '**')
    .replace(/<\/(?:strong|b)>/gi, '**').replace(/<(?:em|i)\b[^>]*>/gi, '*')
    .replace(/<\/(?:em|i)>/gi, '*').replace(/<[^>]*>/g, '')).trim();
}
function plain(markdown) {
  const inline = tokens => tokens.map(t => t.children ? inline(t.children) :
    t.type === 'softbreak' || t.type === 'hardbreak' ? '\n' :
      t.block && t.nesting === -1 ? '\n' :
      t.type === 'html_inline' || t.type === 'html_block' ? htmlToMarkdown(t.content) :
        t.nesting === 0 ? t.content : '').join('');
  return decodeHTML(inline(md.parse(markdown, {}))).replace(/[ \t]+/g, ' ').trim();
}
function cell(markdown, colSpan = 1, rowSpan = 1, header = false) {
  return { markdown, text: plain(markdown), colSpan, rowSpan, header };
}
function htmlTable(html) {
  const rows = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [];
    for (const item of row[1].matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/(?:td|th)>/gi)) {
      const span = name => Math.max(1, Number(item[2].match(new RegExp(name + '\\s*=\\s*["\x27]?(\\d+)', 'i'))?.[1] || 1));
      cells.push(cell(htmlToMarkdown(item[3]), span('colspan'), span('rowspan'), item[1].toLowerCase() === 'th'));
    }
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) throw new Error('Empty/unrecognized HTML table');
  return rows;
}
function markdownTable(tokens) {
  const rows = []; let row;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'tr_open') { row = []; rows.push(row); }
    if (t.type === 'th_open' || t.type === 'td_open') row.push(cell(tokens[i + 1]?.content || '', 1, 1, t.type === 'th_open'));
  }
  return rows;
}
function buildChapter(language, file, number) {
  const sourcePath = 'book/' + (language.folder ? language.folder + '/' : '') + file;
  const source = fs.readFileSync(path.join(root, sourcePath), 'utf8').replace(/\r\n/g, '\n');
  const lines = source.split('\n');
  const tokens = md.parse(source, {});
  const chapterId = `${language.code}-${number}`;
  const blocks = []; const occurrences = new Map();
  const add = block => {
    if (!block.text.trim()) return;
    const key = hash(block.kind + '\n' + block.text).slice(0, 12);
    const count = (occurrences.get(key) || 0) + 1; occurrences.set(key, count);
    blocks.push({ id: `${chapterId}-${key}-${count}`, ...block });
  };
  let cursor = 0;
  const flush = end => {
    const markdown = lines.slice(cursor, end).join('\n').trim();
    if (markdown) {
      if (language.code === 'method' && !markdown.includes('\n') && /^[А-ЯЁ][А-Яа-яЁё ,…–—-]{2,65}$/.test(markdown)) add({ kind: 'heading', level: 2, text: markdown });
      else add({ kind: 'text', markdown, text: plain(markdown) });
    }
    cursor = end;
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.level !== 0 || !t.map) continue;
    if (t.type === 'heading_open') {
      flush(t.map[0]); add({ kind: 'heading', level: Number(t.tag.slice(1)), text: plain(tokens[i + 1].content) }); cursor = t.map[1];
    } else if (t.type === 'table_open') {
      flush(t.map[0]); const end = tokens.findIndex((v, j) => j > i && v.type === 'table_close');
      const rows = markdownTable(tokens.slice(i, end + 1));
      add({ kind: 'table', rows, text: rows.map(r => r.map(c => c.text).join(' | ')).join('\n') }); cursor = t.map[1]; i = end;
    } else if (t.type === 'html_block' && /<table\b/i.test(t.content)) {
      flush(t.map[0]);
      let at = 0;
      for (const match of t.content.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
        const before = htmlToMarkdown(t.content.slice(at, match.index));
        if (before) add({ kind: 'text', markdown: before, text: plain(before) });
        const rows = htmlTable(match[0]);
        add({ kind: 'table', rows, text: rows.map(r => r.map(c => c.text).join(' | ')).join('\n') });
        at = match.index + match[0].length;
      }
      const tail = htmlToMarkdown(t.content.slice(at)); if (tail) add({ kind: 'text', markdown: tail, text: plain(tail) });
      cursor = t.map[1];
    } else if (t.type === 'paragraph_open' || t.type === 'bullet_list_open' || t.type === 'ordered_list_open' || t.type === 'blockquote_open') {
      flush(t.map[0]); flush(t.map[1]);
    }
  }
  flush(lines.length);
  // Footnote definitions are retained as numbered notes even without a Markdown plugin.
  for (const block of blocks) if (block.kind === 'text') {
    block.markdown = block.markdown.replace(/^\[\^(\d+)\]:/gm, '**Примечание $1.**').replace(/\[\^(\d+)\]/g, '⁽$1⁾');
    block.text = plain(block.markdown);
  }
  const title = language.code === 'method' ? 'Введение. Как пользоваться методом' :
    blocks.find(b => b.kind === 'heading')?.text || file.replace(/\.md$/, '');
  return { id: chapterId, language: language.code, number, title, sourcePath, sourceHash: hash(source), blocks };
}
const chapters = languages.flatMap(language => language.folder ?
  fs.readdirSync(path.join(root, 'book', language.folder)).filter(f => f.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }))
    .map(file => buildChapter(language, file, Number(file.match(/^\d+/)?.[0] || 9))) : [buildChapter(language, 'preface.md', 0)]);
const output = JSON.stringify({ title: 'Как выучить много иностранных языков? Диалектический подход', author: 'Руслан Назаров',
  languages: languages.map(({ folder, ...language }) => language), chapters }, null, 2) + '\n';
const destination = path.join(root, 'src/data/book.generated.json');
if (process.argv.includes('--check')) {
  // Git may check text files out with CRLF on Windows. Compare content, not EOLs.
  if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8').replace(/\r\n/g, '\n') !== output) throw new Error('Book data is stale. Run npm run book:build.');
} else fs.writeFileSync(destination, output);
console.log(`Book: ${chapters.length} chapters, ${chapters.reduce((n, c) => n + c.blocks.length, 0)} blocks, ${Buffer.byteLength(output)} bytes. ${process.argv.includes('--check') ? 'Verified.' : 'Built.'}`);
