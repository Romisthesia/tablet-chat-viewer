/**
 * 数据包验证：导出→导入往返，以及「重开页面自动恢复」这条真实用户路径。
 * 数据包不存在时会先自动生成。
 */
const puppeteer = require('puppeteer-core');
const C = require('./_config.js');

const fails = [];
const chk = (n, c, d) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? '  → ' + d : '')); if (!c) fails.push(n); };

async function buildPkg(page) {
  const info = await C.ingestAll(page);
  const txt = await page.evaluate(() => JSON.stringify(window.__viewer.serialize()));
  C.fs.writeFileSync(C.PKG, txt, 'utf8');
  return info;
}

(async () => {
  C.ensureOut();
  const browser = await puppeteer.launch({ executablePath: C.chromePath(), headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });

  // ---- A. 确保数据包存在（用查看器自己的 serialize 生成，保证格式一致） ----
  {
    const { page } = await C.openViewer(browser);
    if (!C.fs.existsSync(C.PKG)) {
      const info = await buildPkg(page);
      console.log('已生成数据包：' + C.fmtBytes(C.fs.statSync(C.PKG).size) + '（' + info.sessions + ' 会话 / ' + info.total.toLocaleString() + ' 条）');
    }
    await page.close();
  }
  const pkgTxt = C.fs.readFileSync(C.PKG, 'utf8');
  const pkgJson = JSON.parse(pkgTxt);
  let pkgMsgs = 0; pkgJson.sessions.forEach(s => pkgMsgs += s.m.length);
  console.log('数据包：' + C.fmtBytes(pkgTxt.length) + ' | ' + pkgJson.sessions.length + ' 会话 / ' + pkgMsgs.toLocaleString() + ' 条 | 我 = ' + pkgJson.meName);

  // ---- B. 经真实 file input 导入数据包 ----
  const { page, errors } = await C.openViewer(browser);
  await page.evaluate(async (txt) => {
    const dt = new DataTransfer();
    dt.items.add(new File([txt], 'chat_data.json', { type: 'application/json' }));
    const el = document.getElementById('f-pkg');
    el.files = dt.files;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, pkgTxt);
  await C.sleep(2500);
  const after = await page.evaluate(() => ({
    hidden: document.getElementById('intro').classList.contains('hide'),
    sessions: window.__viewer.S.sessions.length,
    total: window.__viewer.S.sessions.reduce((a, s) => a + s.n, 0),
    me: window.__viewer.S.meName,
    rows: document.querySelectorAll('#list .row').length,
    hd: document.getElementById('hd-name').textContent,
    meta: document.getElementById('hd-meta').textContent
  }));
  console.log('导入后：' + JSON.stringify(after));
  chk('导入数据包后进入主界面', after.hidden);
  chk('会话数与数据包一致', after.sessions === pkgJson.sessions.length, after.sessions + ' vs ' + pkgJson.sessions.length);
  chk('消息数与数据包一致', after.total === pkgMsgs, after.total.toLocaleString() + ' vs ' + pkgMsgs.toLocaleString());
  chk('「我」被正确恢复', !!after.me && after.me === pkgJson.meName, after.me);
  chk('侧栏列出全部会话', after.rows === pkgJson.sessions.length, after.rows);
  chk('自动打开了最近会话', !!after.hd && after.hd.indexOf('全文搜索') < 0, after.hd + ' | ' + after.meta);

  // ---- C. 重开页面自动恢复（不用再选文件） ----
  await page.goto('about:blank');
  await page.goto(C.PAGE, { waitUntil: 'load' });
  await page.waitForFunction('!!window.__viewer', { timeout: 30000 });
  await C.sleep(3000);
  const restored = await page.evaluate(() => ({
    hidden: document.getElementById('intro').classList.contains('hide'),
    sub: document.getElementById('intro-sub').textContent,
    sessions: window.__viewer.S.sessions.length,
    total: window.__viewer.S.sessions.reduce((a, s) => a + s.n, 0),
    bubbles: document.querySelectorAll('#msgs .m').length
  }));
  console.log('重开：' + JSON.stringify(restored));
  chk('重开自动恢复（无需再选文件夹）',
    restored.hidden && restored.sessions === pkgJson.sessions.length && restored.total === pkgMsgs,
    restored.sessions + ' 会话 / ' + restored.total.toLocaleString() + ' 条');
  await page.screenshot({ path: C.path.join(C.OUT, 'pkg_restore.png') });


  // ---- D. 缓存开关 与「清除本地缓存」 ----
  page.on('dialog', async d => { await d.accept(); });        // 清除缓存前有确认弹窗，自动确认

  await page.evaluate(() => document.getElementById('btn-set').click());   // 打开面板才会回填控件状态
  await C.sleep(250);
  const ui = await page.evaluate(() => {
    const a = document.getElementById('set-auto');
    return { hasAuto: !!a, autoChecked: !!(a && a.checked), hasClear: !!document.getElementById('btn-clear-cache') };
  });
  chk('设置里有「记住导入的数据」开关且默认开启', ui.hasAuto && ui.autoChecked, JSON.stringify(ui));
  chk('设置里有「清除本地缓存」按钮', ui.hasClear);

  // D1：关掉开关 → 刷新后不应自动恢复
  await page.evaluate(() => { const el = document.getElementById('set-auto'); el.checked = false; el.dispatchEvent(new Event('change')); });
  await C.sleep(300);
  await page.goto('about:blank');
  await page.goto(C.PAGE, { waitUntil: 'load' });
  await page.waitForFunction('!!window.__viewer');
  await C.sleep(1500);
  const offState = await page.evaluate(() => ({
    hidden: document.getElementById('intro').classList.contains('hide'),
    sessions: window.__viewer.S.sessions.length,
    remember: window.__viewer.S.remember
  }));
  chk('关掉开关后不再自动恢复（停在导入页）', !offState.hidden && offState.sessions === 0, JSON.stringify(offState));

  // D2：点「清除本地缓存」
  await page.evaluate(() => document.getElementById('btn-set').click());
  await C.sleep(250);
  await page.evaluate(() => document.getElementById('btn-clear-cache').click());
  await C.sleep(1500);
  const cleared = await page.evaluate(async () => {
    let dbs = null;
    try { dbs = (await indexedDB.databases()).map(d => d.name); } catch (e) { return { dbs: 'unavailable' }; }
    return { dbs, present: dbs.indexOf('chatviewer') >= 0, msg: document.getElementById('set-msg').textContent };
  });
  chk('清除后浏览器里不再有缓存数据库', cleared.present === false, JSON.stringify(cleared));

  // D3：重新打开开关 → 再导入 → 刷新 → 自动恢复又能用（可逆）
  await page.evaluate(() => { const el = document.getElementById('set-auto'); el.checked = true; el.dispatchEvent(new Event('change')); });
  await page.evaluate(async (txt) => {
    const dt = new DataTransfer();
    dt.items.add(new File([txt], 'chat_data.json', { type: 'application/json' }));
    const el = document.getElementById('f-pkg'); el.files = dt.files; el.dispatchEvent(new Event('change', { bubbles: true }));
  }, pkgTxt);
  await C.sleep(2500);
  await page.goto('about:blank');
  await page.goto(C.PAGE, { waitUntil: 'load' });
  await page.waitForFunction('!!window.__viewer');
  await C.sleep(2500);
  const again = await page.evaluate(() => ({
    hidden: document.getElementById('intro').classList.contains('hide'),
    sessions: window.__viewer.S.sessions.length,
    total: window.__viewer.S.sessions.reduce((a, s) => a + s.n, 0)
  }));
  chk('重新开启后自动恢复又生效（可逆）', again.hidden && again.sessions === pkgJson.sessions.length, JSON.stringify(again));

  console.log('\n页面错误：' + (errors.length ? JSON.stringify(errors.slice(0, 5)) : '无'));
  chk('无页面错误', errors.length === 0);
  console.log('\n结果: ' + (fails.length ? 'FAILED -> ' + fails.join(' | ') : 'ALL PASS'));
  await browser.close();
  process.exit(fails.length ? 2 : 0);
})().catch(e => { console.error('HARNESS FAIL', e); process.exit(1); });
