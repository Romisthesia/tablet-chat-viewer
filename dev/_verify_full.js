/**
 * 全量压测：所有记录文件一次导入，测解析耗时、内存、大会话切换与分批渲染、数据包往返。
 */
const puppeteer = require('puppeteer-core');
const C = require('./_config.js');
const { extractArray } = require('./_parse.js');

const fails = [];
const chk = (n, c, d) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? '  → ' + d : '')); if (!c) fails.push(n); };

(async () => {
  const names = C.htmlFiles();
  let nodeTotal = 0;
  for (const f of names) nodeTotal += new Function('return ' + extractArray(C.fs.readFileSync(C.path.join(C.DIR, f), 'utf8')))().length;
  console.log('记录目录：' + C.DIR);
  console.log('node 基准：' + names.length + ' 个文件 / ' + nodeTotal.toLocaleString() + ' 条');

  const browser = await puppeteer.launch({ executablePath: C.chromePath(), headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const { page, errors } = await C.openViewer(browser);

  const t0 = Date.now();
  const info = await C.ingestAll(page);
  const wallMs = Date.now() - t0;
  console.log('=== 全量导入 ===');
  console.log(`${info.sessions} 会话 / ${info.total.toLocaleString()} 条（node 基准 ${nodeTotal.toLocaleString()}）| 解析 ${info.ms}ms | 端到端 ${wallMs}ms`);
  chk('消息总数与 node 基准一致', info.total === nodeTotal, info.total + ' vs ' + nodeTotal);
  chk('没有文件被跳过', info.bad === 0, info.bad ? info.badList.join(',') : '0');

  const perf = await page.evaluate(() => {
    const S = window.__viewer.S, mem = () => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1;
    const imgs = s => s.msgs.filter(m => m.url).length;
    const big = S.sessions.slice().sort((a, b) => b.n - a.n)[0];
    const t1 = performance.now();
    window.__viewer.openSession(big.id);
    const openMs = Math.round(performance.now() - t1);
    const renderedFirst = document.querySelectorAll('#msgs .m').length;   // 点「再往前」之前，先看首屏渲染了多少
    const t2 = performance.now();
    const b = document.getElementById('btn-more2'); if (b) b.click();
    const moreMs = Math.round(performance.now() - t2);
    let oldest = Infinity, newest = 0;
    S.sessions.forEach(s => { oldest = Math.min(oldest, s.first); newest = Math.max(newest, s.last); });
    return {
      bigName: big.name, bigN: big.n, openMs, moreMs, renderedFirst,
      rendered: document.querySelectorAll('#msgs .m').length,
      renderedImgs: [...document.querySelectorAll('#msgs .imgwrap')].length,
      rows: document.querySelectorAll('#list .row').length,
      sessions: S.sessions.length, me: S.meName,
      oldest: new Date(oldest).toISOString().slice(0, 10), newest: new Date(newest).toISOString().slice(0, 10),
      totalImgs: S.sessions.reduce((a, s) => a + imgs(s), 0), mem: mem()
    };
  });
  console.log('=== 性能 ===');
  console.log(JSON.stringify(perf));
  chk('侧栏列出全部会话', perf.rows === perf.sessions, perf.rows);
  chk('打开最大会话够快(<2s)', perf.openMs < 2000, perf.openMs + 'ms / ' + perf.bigN + ' 条');
  chk('首屏只渲染一批（不卡死）', perf.renderedFirst > 0 && perf.renderedFirst < perf.bigN / 4, perf.renderedFirst + ' / ' + perf.bigN);
  chk('分批载入够快(<2s)', perf.moreMs < 2000, perf.moreMs + 'ms → ' + perf.rendered + ' 条');
  C.ensureOut();
  await C.sleep(3000);
  await page.screenshot({ path: C.path.join(C.OUT, 'full_library.png') });

  const pkg = await page.evaluate(() => {
    const t0 = performance.now();
    const txt = JSON.stringify(window.__viewer.serialize());
    const serMs = Math.round(performance.now() - t0);
    const t1 = performance.now();
    const d = JSON.parse(txt);
    const parMs = Math.round(performance.now() - t1);
    let n = 0; d.sessions.forEach(s => n += s.m.length);
    return { mb: Math.round(txt.length / 1048576 * 10) / 10, serMs, parMs, msgs: n, sessions: d.sessions.length, me: d.meName };
  });
  console.log('=== 数据包 ===');
  console.log(JSON.stringify(pkg));
  chk('数据包条数一致', pkg.msgs === nodeTotal, pkg.msgs + ' vs ' + nodeTotal);
  chk('数据包往返够快(<5s)', pkg.serMs + pkg.parMs < 5000, pkg.serMs + 'ms 序列化 + ' + pkg.parMs + 'ms 解析');

  console.log('\n页面错误：' + (errors.length ? JSON.stringify(errors.slice(0, 5)) : '无'));
  chk('无页面错误', errors.length === 0);
  console.log('\n结果: ' + (fails.length ? 'FAILED -> ' + fails.join(' | ') : 'ALL PASS'));
  await browser.close();
  process.exit(fails.length ? 2 : 0);
})().catch(e => { console.error('HARNESS FAIL', e); process.exit(1); });
