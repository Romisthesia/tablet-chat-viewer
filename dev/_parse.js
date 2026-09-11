// 解析器：与查看器页面里那份逻辑完全一致。可独立当命令行工具用：
//   CHAT_DIR=/path/to/records node _parse.js
const fs = require('fs'), path = require('path');
const DIR = process.env.CHAT_DIR || path.join(__dirname, '..', 'sample_data');

function extractArray(raw) {
  const key = 'var array = ';
  const k = raw.indexOf(key);
  if (k < 0) throw new Error('no array decl');
  let i = k + key.length;
  while (raw[i] !== '[') i++;
  const start = i;
  let depth = 0, inStr = false, esc = false, quote = '';
  for (; i < raw.length; i++) {
    const c = raw[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (inStr) { if (c === quote) inStr = false; continue; }
    if (c === "'" || c === '"') { inStr = true; quote = c; continue; }
    if (c === '[' || c === '{') { depth++; continue; }
    if (c === ']' || c === '}') { depth--; if (depth === 0 && c === ']') { i++; break; } }
  }
  return raw.slice(start, i);
}

module.exports = { extractArray };

if (require.main === module) {
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.html'));
  let total = 0, fail = 0;
  const perFile = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(DIR, f), 'utf8');
    try {
      const txt = extractArray(raw);
      const arr = new Function('return ' + txt)();
      total += arr.length;
      perFile.push({ f, n: arr.length, sliced: txt.length, tail: raw.slice(raw.indexOf(txt) + txt.length, raw.indexOf(txt) + txt.length + 20) });
    } catch (e) { fail++; console.log('FAIL', f, String(e).slice(0, 120)); }
  }
  console.log('files', files.length, 'fail', fail, 'total msgs', total);
  console.log('tails ok(every file should show "];var html"):', perFile.every(p => p.tail.startsWith('];var html')));
  console.log('top10:', perFile.sort((a, b) => b.n - a.n).slice(0, 10).map(p => p.f + '=' + p.n).join(' | '));
  const big = perFile.filter(p => p.sliced > 1e6);
  console.log('files >1MB body:', big.length);
}
