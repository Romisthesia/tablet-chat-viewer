/**
 * 共享配置与工具：所有脚本的路径都从这里取，不写死任何人的机器。
 *
 * 可覆盖的环境变量：
 *   CHAT_DIR   聊天记录 HTML 所在目录（默认 ../sample_data，即项目自带的虚构样例）
 *   SHOT_DIR   截图输出目录（默认 ./screenshots，已 gitignore）
 *   PKG_OUT    数据包输出路径（默认 ../chat_data.json，已 gitignore）
 *   CHROME     Chrome 可执行文件路径（默认自动探测）
 */
const fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');                            // 项目根目录
const DIR = process.env.CHAT_DIR || path.join(ROOT, 'sample_data');    // 记录目录
const OUT = process.env.SHOT_DIR || path.join(__dirname, 'screenshots');
const PKG = process.env.PKG_OUT || path.join(ROOT, 'chat_data.json');
const PAGE = 'file:///' + path.join(ROOT, 'chat_viewer.html').replace(/\\/g, '/');

function chromePath() {
  const cands = [
    process.env.CHROME,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  throw new Error('找不到 Chrome，请设置 CHROME=/path/to/chrome');
}

function htmlFiles() {
  if (!fs.existsSync(DIR)) {
    throw new Error('找不到记录目录：' + DIR + '\n请设置 CHAT_DIR 指向存放导出 HTML 的文件夹。');
  }
  const list = fs.readdirSync(DIR).filter(f => /\.html?$/i.test(f));
  if (!list.length) throw new Error(DIR + ' 里没有 .html 文件');
  return list;
}

/** 读出全部记录文件内容，供灌进页面用 */
function loadAll() {
  return htmlFiles().map(f => ({ name: f, text: fs.readFileSync(path.join(DIR, f), 'utf8') }));
}

function ensureOut() { fs.mkdirSync(OUT, { recursive: true }); }

/** 人可读的字节数：小数据量不会被 MB 四舍五入成 0 */
function fmtBytes(n) {
  if (n < 1024) return n + 'B';
  if (n < 1048576) return Math.round(n / 1024) + 'KB';
  return (n / 1048576).toFixed(1) + 'MB';
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 启动一个指向查看器的 headless Chrome 页面，并收集页面错误 */
async function openViewer(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 950 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 200)); });
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForFunction('!!window.__viewer', { timeout: 30000 });
  return { page, errors };
}

/** 把记录灌进页面并统计出「我」 */
async function ingestAll(page) {
  const files = loadAll();
  await page.evaluate(() => { window.__buf = []; });
  for (let i = 0; i < files.length; i += 8) {
    const batch = files.slice(i, i + 8);
    await page.evaluate(b => b.forEach(x => window.__buf.push(x)), batch);
  }
  return page.evaluate(() => {
    const t0 = performance.now();
    const r = window.__viewer.buildSessions(window.__buf);
    const me = window.__viewer.computeMe(r.sessions);
    const S = window.__viewer.S;
    S.sessions = r.sessions;
    if (me) { S.meId = me.id; S.meName = me.name; }
    window.__viewer.renderSidebar();
    return { ms: Math.round(performance.now() - t0), sessions: r.sessions.length, total: r.sessions.reduce((a, s) => a + s.n, 0), bad: r.bad, badList: r.badList, me: S.meName, meId: S.meId };
  });
}

/**
 * 按数据本身的特征挑会话，避免测试依赖某个具体会话名：
 *   biggest    消息最多的会话（测分批载入）
 *   single     消息最多的私聊（测左右气泡）
 *   imgGroup   图片最多的群聊（测图片/灯箱/群昵称）
 *   anyImg     图片最多的会话，不分群私（测灯箱）
 */
function pickSessions(page) {
  return page.evaluate(() => {
    const S = window.__viewer.S, imgs = s => s.msgs.filter(m => m.url).length;
    const desc = (f) => S.sessions.slice().sort((a, b) => f(b) - f(a));
    const byN = desc(s => s.n), byImg = desc(imgs);
    const pick = {
      biggest: byN[0] && byN[0].id,
      single: (byN.find(s => s.kind === 'SINGLE' && s.n >= 2) || {}).id || null,
      imgGroup: (byImg.find(s => s.kind === 'GROUP' && imgs(s) > 0) || {}).id || null,
      anyImg: (byImg.find(s => imgs(s) > 0) || {}).id || null,
      meName: S.meName
    };
    return pick;
  });
}

module.exports = { fs, path, ROOT, DIR, OUT, PKG, PAGE, chromePath, htmlFiles, loadAll, ensureOut, fmtBytes, sleep, openViewer, ingestAll, pickSessions };
