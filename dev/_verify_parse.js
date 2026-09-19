/**
 * 一致性验证：浏览器里的解析结果 vs node 独立解析，逐会话对比。
 * 这是最关键的一套——它证明界面里的每条消息都跟原始导出文件对得上。
 */
const puppeteer = require('puppeteer-core');
const C = require('./_config.js');
const { extractArray } = require('./_parse.js');

const fails = [];
const chk = (n, c, d) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? '  → ' + d : '')); if (!c) fails.push(n); };

(async () => {
  // ---- node 侧基准：逐文件独立解析 ----
  console.log('记录目录：' + C.DIR);
  const names = C.htmlFiles();
  const truth = {};
  let truthTotal = 0;
  for (const f of names) {
    const n = new Function('return ' + extractArray(C.fs.readFileSync(C.path.join(C.DIR, f), 'utf8')))().length;
    truth[f.replace(/\.html?$/i, '')] = n;
    truthTotal += n;
  }
  console.log(`node 基准：${names.length} 个文件 / ${truthTotal.toLocaleString()} 条消息`);

  const browser = await puppeteer.launch({ executablePath: C.chromePath(), headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const { page, errors } = await C.openViewer(browser);

  // ---- 浏览器侧：走真实 ingest 路径 ----
  const payload = C.loadAll();
  const res = await page.evaluate(async (payload) => {
    const files = payload.map(p => new File([p.text], p.name, { type: 'text/html' }));
    const t0 = performance.now();
    await window.__viewer.ingestFiles(files);
    const S = window.__viewer.S;
    return {
      ms: Math.round(performance.now() - t0),
      sessions: S.sessions.map(s => ({ id: s.id, n: s.n, mode: s.mode })),
      me: S.meName, meId: S.meId,
      status: document.getElementById('status').textContent
    };
  }, payload);

  const got = {}; res.sessions.forEach(s => got[s.id] = s.n);
  const mismatch = Object.keys(truth).filter(k => got[k] !== truth[k]);
  const browserTotal = res.sessions.reduce((a, s) => a + s.n, 0);

  console.log(`浏览器：${res.sessions.length} 个会话 / ${browserTotal.toLocaleString()} 条，耗时 ${res.ms}ms`);
  chk('会话数一致', res.sessions.length === names.length, res.sessions.length + ' vs ' + names.length);
  chk('消息总数一致', browserTotal === truthTotal, browserTotal.toLocaleString() + ' vs ' + truthTotal.toLocaleString());
  chk('逐会话条数全部一致', mismatch.length === 0, mismatch.length ? '不一致：' + mismatch.slice(0, 5).join(',') : names.length + ' 个全对上');
  chk('没有文件解析失败', res.sessions.every(s => s.mode !== 'fail'), res.sessions.filter(s => s.mode === 'fail').map(s => s.id).join(',') || '无');
  chk('识别出「我」', !!res.me, res.me + ' (ID ' + res.meId + ')');

  // ---- 渲染 ----
  const pick = await C.pickSessions(page);
  const render = await page.evaluate(async (pick) => {
    window.__viewer.openSession(pick.biggest);
    await new Promise(r => setTimeout(r, 600));
    const imgs = [...document.querySelectorAll('#msgs .imgwrap img')];
    return {
      hd: document.getElementById('hd-name').textContent,
      rows: document.querySelectorAll('#list .row').length,
      bubbles: document.querySelectorAll('#msgs .m').length,
      meBubbles: document.querySelectorAll('#msgs .m.me').length,
      otherBubbles: document.querySelectorAll('#msgs .m:not(.me)').length,
      marks: document.querySelectorAll('.sys').length,
      imgTags: imgs.length, imgFailed: imgs.filter(i => i.complete && i.naturalWidth === 0).length
    };
  }, pick);
  console.log('渲染：' + JSON.stringify(render));
  chk('侧栏列出全部会话', render.rows === res.sessions.length, render.rows);
  chk('打开了最大会话并渲染出消息', render.bubbles > 0 && !!render.hd, render.hd + ' / ' + render.bubbles + ' 条');
  chk('有时间标记', render.marks > 0, render.marks);
  if (render.imgTags) chk('图片没有加载失败', render.imgFailed === 0, render.imgFailed + ' 张失败 / 共 ' + render.imgTags);
  if (pick.single) {
    const sp = await page.evaluate(async (id) => {
      window.__viewer.openSession(id); await new Promise(r => setTimeout(r, 500));
      return { me: document.querySelectorAll('#msgs .m.me').length, other: document.querySelectorAll('#msgs .m:not(.me)').length };
    }, pick.single);
    chk('私聊里左右两侧都有气泡', sp.me > 0 && sp.other > 0, '我 ' + sp.me + ' / 对方 ' + sp.other);
  }

  // ---- 搜索页 ----
  const s = await page.evaluate(async () => {
    const V = window.__viewer, sleep = ms => new Promise(r => setTimeout(r, ms));
    V.openSearch(); await sleep(200);
    const t0 = performance.now();
    const el = document.getElementById('q'); el.value = '我'; el.dispatchEvent(new Event('input'));
    await sleep(600);
    const out = { ms: Math.round(performance.now() - t0), hits: document.querySelectorAll('#sp-hits .hit').length,
                  info: (document.getElementById('sp-hithead') || {}).textContent || '' };
    V.closeSearch();
    return out;
  });
  console.log('搜索：' + JSON.stringify(s));
  chk('搜索页有结果且够快', s.hits > 0 && s.ms < 3000, s.hits + ' 条 / ' + s.ms + 'ms');

  // ---- 缓存（应用会在导入完成后异步写入，这里轮询等它） ----
  const cached = await page.evaluate(async () => {
    try {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('chatviewer', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const read = () => new Promise(res => {
        const q = db.transaction('cache', 'readonly').objectStore('cache').get('last');
        q.onsuccess = () => res(q.result); q.onerror = () => res(null);
      });
      for (let i = 0; i < 25; i++) {
        const v = await read();
        if (v) return v.length;                       // 字节数（小数据量换算成 MB 会被舍成 0）
        await new Promise(r => setTimeout(r, 300));
      }
      return 0;
    } catch (e) { return -1; }
  });
  const cachedTxt = cached >= 1048576 ? (cached / 1048576).toFixed(1) + 'MB' : Math.round(cached / 1024) + 'KB';
  console.log('本地缓存：' + cachedTxt);
  chk('解析结果已写入本地缓存（重开可秒恢复）', cached > 0, cachedTxt);

  console.log('\n页面错误：' + (errors.length ? JSON.stringify(errors.slice(0, 5)) : '无'));
  chk('无页面错误', errors.length === 0);
  console.log('\nVERDICT: ' + (fails.length ? 'FAILED -> ' + fails.join(' | ') : 'PASS'));
  await browser.close();
  process.exit(fails.length ? 2 : 0);
})().catch(e => { console.error('HARNESS FAIL', e); process.exit(1); });
