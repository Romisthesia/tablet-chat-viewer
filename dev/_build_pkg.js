/**
 * 把记录目录整体转成一个数据包（chat_data.json），供查看器一键导入。
 * 用查看器自身的 serialize() 输出，保证格式 100% 兼容。
 *   CHAT_DIR=/path/to/records npm run build
 */
const puppeteer = require('puppeteer-core');
const C = require('./_config.js');

(async () => {
  const browser = await puppeteer.launch({ executablePath: C.chromePath(), headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const { page } = await C.openViewer(browser);
  const info = await C.ingestAll(page);
  const txt = await page.evaluate(() => JSON.stringify(window.__viewer.serialize()));
  C.fs.writeFileSync(C.PKG, txt, 'utf8');
  console.log('已写出 ' + C.PKG);
  console.log(`大小 ${C.fmtBytes(txt.length)} | 会话 ${info.sessions} | 消息 ${info.total.toLocaleString()} | 我 = ${info.me} (${info.meId})`);
  await browser.close();
})().catch(e => { console.error('FAIL', e.message || e); process.exit(1); });
