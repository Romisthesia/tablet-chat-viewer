/**
 * 界面验证：布局几何、配色、图片、灯箱、搜索跳转、深色模式、设置。
 * 会话按数据特征动态挑选，不依赖任何具体会话名。
 */
const puppeteer = require('puppeteer-core');
const C = require('./_config.js');

const fails = [];
const chk = (n, c, d) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? '  → ' + d : '')); if (!c) fails.push(n); };

(async () => {
  C.ensureOut();
  const browser = await puppeteer.launch({ executablePath: C.chromePath(), headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const { page, errors } = await C.openViewer(browser);
  const info = await C.ingestAll(page);
  await C.sleep(1200);
  const pick = await C.pickSessions(page);
  console.log('数据：' + info.sessions + ' 会话 / ' + info.total.toLocaleString() + ' 条 | 我 = ' + info.me);
  console.log('选中：' + JSON.stringify(pick) + '\n');

  // ---------- 1. 私聊布局几何 ----------
  if (!pick.single) { chk('取到私聊会话用于布局测试', false, '数据里没有可用私聊'); }
  else {
    await page.evaluate(id => window.__viewer.openSession(id), pick.single);
    await C.sleep(600);
    const geo = await page.evaluate(() => {
      const g = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width) }; };
      const cs = el => getComputedStyle(el);
      const me = document.querySelector('#msgs .m.me .bub');
      const other = document.querySelector('#msgs .m:not(.me) .bub');
      return {
        side: g(document.getElementById('side')),
        meBox: me ? g(me) : null, otherBox: other ? g(other) : null,
        meBg: me ? cs(me).backgroundColor : null, otherBg: other ? cs(other).backgroundColor : null,
        chatBg: cs(document.getElementById('main')).backgroundColor,
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        rowHeights: [...document.querySelectorAll('#msgs .m')].map(r => Math.round(r.getBoundingClientRect().height)),
        fontSize: cs(other || document.body).fontSize
      };
    });
    console.log('几何：' + JSON.stringify(geo));
    chk('侧栏宽度合理(280~320)', geo.side.w >= 280 && geo.side.w <= 320, geo.side.w);
    chk('无横向溢出', !geo.overflowX);
    chk('我方气泡整体靠右、对方靠左', geo.meBox && geo.otherBox &&
      (geo.meBox.x + geo.meBox.w) > (geo.otherBox.x + geo.otherBox.w) && geo.meBox.x > geo.otherBox.x,
      geo.meBox && geo.otherBox ? `me=[${geo.meBox.x},${geo.meBox.x + geo.meBox.w}] other=[${geo.otherBox.x},${geo.otherBox.x + geo.otherBox.w}]` : 'n/a');
    chk('我方气泡是微信绿', geo.meBg === 'rgb(149, 236, 105)', geo.meBg);
    chk('对方气泡是白色', geo.otherBg === 'rgb(255, 255, 255)', geo.otherBg);
    chk('正文字号 14px', geo.fontSize === '14px', geo.fontSize);
    chk('气泡高度均正常', geo.rowHeights.length > 0 && geo.rowHeights.every(h => h > 0), geo.rowHeights.join(','));
  }

  // ---------- 2. 群聊：图片 + 发言人昵称 + 分批载入 ----------
  const target = pick.imgGroup || pick.anyImg;
  if (target) {
    await page.evaluate(id => window.__viewer.openSession(id), target);
    await C.sleep(5000);                                    // 等图片从图床实际加载
    const grp = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('#msgs .imgwrap img')];
      const loaded = imgs.filter(i => i.complete && i.naturalWidth > 0);
      const first = loaded[0];
      const box = first ? first.getBoundingClientRect() : null;
      return {
        cur: window.__viewer.S.cur.name, kind: window.__viewer.S.cur.kind,
        rendered: document.querySelectorAll('#msgs .m').length,
        who: document.querySelectorAll('#msgs .who').length,
        imgTags: imgs.length, loaded: loaded.length,
        firstImg: box ? { w: Math.round(box.width), h: Math.round(box.height) } : null,
        loadmoreVisible: !!document.getElementById('btn-more'),
        moreText: (document.getElementById('btn-more') || {}).textContent || ''
      };
    });
    console.log('群聊：' + JSON.stringify(grp));
    if (grp.kind === 'GROUP') chk('群聊显示发送者昵称', grp.who > 0, grp.who + ' 条带昵称');
    if (grp.imgTags) {
      chk('图片真实从图床加载成功', grp.loaded > 0, grp.loaded + '/' + grp.imgTags + '（懒加载，只算已滚到的）');
      chk('图片尺寸被限制在气泡内', !grp.firstImg || (grp.firstImg.w <= 300 && grp.firstImg.h <= 300), JSON.stringify(grp.firstImg));
    }
    await page.screenshot({ path: C.path.join(C.OUT, 'ui_group.png') });
  } else console.log('（这批数据里没有图片消息，跳过图片/群昵称相关检查）');

  // ---------- 3. 分批载入 ----------
  await page.evaluate(id => window.__viewer.openSession(id), pick.biggest);
  await C.sleep(700);
  const before = await page.evaluate(() => { const b = document.getElementById('btn-more2'); return b ? (b.click(), window.__viewer.S.startIdx + 2000) : null; });
  if (before !== null) {
    await C.sleep(600);
    const after = await page.evaluate(() => ({ startIdx: window.__viewer.S.startIdx, rendered: document.querySelectorAll('#msgs .m').length }));
    chk('“再往前2000条”真的往前2000条', after.startIdx <= before - 2000 && after.rendered > 2000, `startIdx ${before}→${after.startIdx}, rendered=${after.rendered}`);
  } else console.log('（会话比渲染窗口还短，跳过分批载入测试）');

  // ---------- 4. 灯箱 ----------
  if (pick.anyImg) {
    await page.evaluate(id => window.__viewer.openSession(id), pick.anyImg);
    await C.sleep(1200);
    const lb = await page.evaluate(async () => {
      // 挑一个「已经在视口内」的图；都没有就取最后一个滚进视野。
      // 不能用第一个再 scrollIntoView —— 滚到顶会触发自动载入更早、DOM 被重建，节点就失效了。
      const all = [...document.querySelectorAll('#msgs .imgwrap')];
      if (!all.length) return { none: true };
      let w = all.find(e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
      if (!w) { w = all[all.length - 1]; w.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 500)); }
      w.click(); await new Promise(r => setTimeout(r, 500));
      return { on: document.getElementById('lb').classList.contains('on'), src: document.getElementById('lb-img').src, info: document.getElementById('lb-info').textContent };
    });
    chk('点图打开大图灯箱', !lb.none && lb.on && /^https?:/.test(lb.src || ''), lb.none ? '没有图片' : (lb.info || '').slice(0, 50));
    await C.sleep(1500);
    await page.screenshot({ path: C.path.join(C.OUT, 'ui_lightbox.png') });
    await page.keyboard.press('Escape');
    await C.sleep(250);
    chk('Esc 关闭灯箱', !(await page.evaluate(() => document.getElementById('lb').classList.contains('on'))));
  }

  // ---------- 5. 全文搜索 → 跳转 → 高亮 ----------
  const hits = await page.evaluate(() => { window.__viewer.doSearch('我'); return document.querySelectorAll('#hits .hit').length; });
  chk('全文搜索有结果', hits > 0, hits + ' 条');
  await page.screenshot({ path: C.path.join(C.OUT, 'ui_search.png') });
  await page.evaluate(() => document.querySelector('#hits .hit').click());
  await C.sleep(900);
  const jump = await page.evaluate(() => {
    const marks = [...document.querySelectorAll('#msgs mark')];
    return {
      marks: marks.length,
      inView: marks.some(m => { const r = m.getBoundingClientRect(); return r.top > 0 && r.bottom < window.innerHeight; }),
      hd: document.getElementById('hd-name').textContent
    };
  });
  chk('搜索结果点击后跳到该会话', jump.hd.indexOf('全文搜索') < 0, jump.hd);
  chk('命中关键词在会话里被高亮', jump.marks > 0, jump.marks + ' 处 <mark>');
  chk('目标消息滚动进入视野', jump.inView);
  await page.screenshot({ path: C.path.join(C.OUT, 'ui_jump.png') });

  // ---------- 6. 深色模式 ----------
  await page.evaluate(() => document.getElementById('btn-theme').click());
  await C.sleep(300);
  await page.evaluate(id => window.__viewer.openSession(id), (pick.imgGroup || pick.biggest));
  await C.sleep(2500);
  const dark = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    chatBg: getComputedStyle(document.getElementById('main')).backgroundColor,
    meBg: (() => { const b = document.querySelector('#msgs .m.me .bub'); return b ? getComputedStyle(b).backgroundColor : null; })()
  }));
  chk('深色模式已生效', dark.theme === 'dark' && dark.chatBg === 'rgb(25, 25, 25)', dark.chatBg);
  await page.screenshot({ path: C.path.join(C.OUT, 'ui_dark.png') });

  // ---------- 7. 设置面板 ----------
  await page.evaluate(() => document.getElementById('btn-set').click());
  await C.sleep(300);
  const set = await page.evaluate(() => {
    const o = [...document.getElementById('set-me').options].find(x => x.selected);
    return { options: document.getElementById('set-me').options.length, selected: o ? o.textContent : null };
  });
  chk('设置里「我」默认选中自动识别的人', !!set.selected && set.selected.indexOf(pick.meName) === 0, JSON.stringify(set));
  await page.screenshot({ path: C.path.join(C.OUT, 'ui_settings.png') });

  console.log('\n页面错误：' + (errors.length ? JSON.stringify(errors.slice(0, 5)) : '无'));
  chk('无页面错误', errors.length === 0);
  console.log('\n结果: ' + (fails.length ? 'FAILED -> ' + fails.join(' | ') : 'ALL PASS'));
  await browser.close();
  process.exit(fails.length ? 2 : 0);
})().catch(e => { console.error('HARNESS FAIL', e); process.exit(1); });
