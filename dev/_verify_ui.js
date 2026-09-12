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
  const sysDefault = await page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  console.log('宿主系统深浅色偏好（未干预）：' + (sysDefault ? '深色' : '浅色'));
  // 主题默认「跟随系统」，会让配色随宿主变化；这里固定成浅色，后面的断言才确定
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.evaluate(() => window.__viewer.setTheme('light'));
  const info = await C.ingestAll(page);
  // 真实导入路径会把导入遮罩藏起来；测试里直接灌数据，这里补上，否则截图拍到的都是遮罩
  await page.evaluate(() => document.getElementById('intro').classList.add('hide'));
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

  // ---------- 4. 灯箱：打开 / 切换 / 关闭 ----------
  const lbState = () => page.evaluate(() => ({
    on: document.getElementById('lb').classList.contains('on'),
    src: document.getElementById('lb-img').src,
    pos: document.getElementById('lb-pos').textContent,
    prevOff: document.getElementById('lb-prev').disabled,
    nextOff: document.getElementById('lb-next').disabled,
    total: window.__viewer.sessionImages().length
  }));
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
    chk('点图打开大图灯箱', !lb.none && lb.on && /^(https?:|data:image\/)/.test(lb.src || ''), lb.none ? '没有图片' : (lb.info || '').slice(0, 50));

    const s1 = await lbState();
    chk('灯箱提供上一张/下一张按钮与「第 n / 共 m」计数',
      s1.total > 1 && /^\d+ \/ \d+$/.test(s1.pos.trim()) && !s1.prevOff && !s1.nextOff,
      JSON.stringify({ 计数: s1.pos, 共几张: s1.total }));

    await page.evaluate(() => document.getElementById('lb-next').click());
    await C.sleep(450);
    const s2 = await lbState();
    chk('点「下一张」按钮切到另一张图', s2.src !== s1.src && s2.pos !== s1.pos, s1.pos.trim() + ' → ' + s2.pos.trim());

    await page.evaluate(() => document.getElementById('lb-prev').click());
    await C.sleep(450);
    const s2b = await lbState();
    chk('点「上一张」按钮切回去', s2b.src === s1.src, s2b.pos.trim());

    await page.keyboard.press('ArrowRight');
    await C.sleep(450);
    const s3 = await lbState();
    chk('方向键 → 切到下一张', s3.src === s2.src, s2.pos.trim() + ' → ' + s3.pos.trim());

    await page.keyboard.press('ArrowLeft');
    await C.sleep(450);
    const s4 = await lbState();
    chk('方向键 ← 切回上一张', s4.src === s1.src, s4.pos.trim());

    // 再按一次确认能继续往前（只按一次，张数少时才不会正好绕回原处）
    await page.keyboard.press('ArrowRight');
    await C.sleep(200);
    const s5 = await lbState();
    chk('继续按 → 能一路往前切', s5.pos !== s4.pos, s4.pos.trim() + ' → ' + s5.pos.trim());
    // 首尾循环：张数多时直接用同一个函数跑完整一圈，避免按几百次键盘
    const loop = await page.evaluate(() => {
      const n = window.__viewer.sessionImages().length;
      const start = document.getElementById('lb-pos').textContent;
      for (let k = 0; k < n; k++) window.__viewer.lbStep(1);
      return { n, start, end: document.getElementById('lb-pos').textContent };
    });
    chk('连按一圈首尾循环回原处', loop.start === loop.end && loop.end !== '',
      loop.start.trim() + ' 绕 ' + loop.n + ' 张 → ' + loop.end.trim());

    await C.sleep(400);
    await page.screenshot({ path: C.path.join(C.OUT, 'ui_lightbox.png') });
    await page.keyboard.press('Escape');
    await C.sleep(300);
    chk('Esc 关闭灯箱', !(await page.evaluate(() => document.getElementById('lb').classList.contains('on'))));

    // 重开后再切会话 —— 灯箱应自动关闭（否则会留着上一个会话的图片列表）
    await page.evaluate(() => { const im = document.querySelector('#msgs .imgwrap'); if (im) im.click(); });
    await C.sleep(500);
    const reopened = await lbState();
    await page.evaluate(id => window.__viewer.openSession(id), pick.biggest);
    await C.sleep(700);
    chk('切换会话时灯箱自动关闭', reopened.on && !(await lbState()).on, '重开=' + reopened.on);
  }

  // ---------- 4b. 我方图片不该被套气泡底色（回归：曾被套上绿色气泡）----------
  const meImgPick = await page.evaluate(() => {
    const S = window.__viewer.S;
    const best = S.sessions.map(s => {
      const idxs = s.msgs.map((m, i) => (m.url && String(m.fromId) === String(S.meId)) ? i : -1).filter(i => i >= 0);
      const last = idxs.length ? idxs[idxs.length - 1] : -1;
      return { id: s.id, name: s.name, last, inWin: last >= Math.max(0, s.n - 250), count: idxs.length };
    }).filter(x => x.last >= 0).sort((a, b) => (b.inWin - a.inWin) || (b.count - a.count))[0];
    return best || null;
  });
  if (meImgPick) {
    await page.evaluate(id => window.__viewer.openSession(id), meImgPick.id);
    await C.sleep(1000);
    const imgBub = await page.evaluate(() => {
      const pick = sel => {
        const el = document.querySelector(sel); if (!el) return null;
        const cs = getComputedStyle(el);
        return { 底色: cs.backgroundColor, 阴影: cs.boxShadow, 内边距: cs.padding };
      };
      return { 我方: pick('#msgs .m.me .bub.imgp'), 对方: pick('#msgs .m:not(.me) .bub.imgp'), 我方图片数: document.querySelectorAll('#msgs .m.me .imgwrap').length };
    });
    if (imgBub.我方) {
      chk('我方图片不套绿色气泡（底色透明、无投影）',
        imgBub.我方.底色 === 'rgba(0, 0, 0, 0)' && imgBub.我方.阴影 === 'none',
        JSON.stringify(imgBub.我方));
    } else console.log('（该会话渲染窗口里没有我方图片，跳过绿色气泡检查）');
    chk('对方图片也不带白色气泡底', !imgBub.对方 || imgBub.对方.底色 === 'rgba(0, 0, 0, 0)',
      imgBub.对方 ? JSON.stringify(imgBub.对方) : '（无对方图片）');
  } else console.log('（数据里没有我方发送的图片，跳过图片气泡底色检查）');

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
  await page.evaluate(() => { window.__viewer.setTheme('light'); });      // 先确保是浅色
  await C.sleep(200);
  await page.evaluate(() => document.getElementById('btn-theme').click()); // 按钮切到深色
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


  // ---------- 6b. 跟随系统深浅主题 ----------
  const themeProbe = () => page.evaluate(() => ({
    设置: window.__viewer.S.theme,
    实际: document.documentElement.dataset.theme,
    聊天背景: getComputedStyle(document.getElementById('main')).backgroundColor,
    按钮标题: document.getElementById('btn-theme').title,
    系统深色: window.matchMedia('(prefers-color-scheme: dark)').matches
  }));

  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.evaluate(() => window.__viewer.setTheme('auto'));
  await C.sleep(250);
  const th1 = await themeProbe();
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await C.sleep(500);
  const th2 = await themeProbe();
  chk('跟随系统：系统浅色→浅色', th1.设置 === 'auto' && th1.实际 === 'light' && th1.聊天背景 === 'rgb(245, 245, 245)', JSON.stringify(th1));
  chk('跟随系统：系统切深色时自动变深', th2.系统深色 && th2.实际 === 'dark' && th2.聊天背景 === 'rgb(25, 25, 25)', JSON.stringify(th2));

  await page.evaluate(() => window.__viewer.setTheme('light'));
  await C.sleep(250);
  const th3 = await themeProbe();
  chk('显式选浅色时不受系统影响（系统仍是深色）', th3.设置 === 'light' && th3.实际 === 'light', JSON.stringify(th3));

  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.evaluate(() => window.__viewer.setTheme('dark'));
  await C.sleep(250);
  const th4 = await themeProbe();
  chk('显式选深色时不受系统影响（系统仍是浅色）', th4.设置 === 'dark' && th4.实际 === 'dark', JSON.stringify(th4));

  // 下拉里应有三个选项
  await page.evaluate(() => document.getElementById('btn-set').click());
  await C.sleep(250);
  const opts = await page.evaluate(() => [...document.getElementById('set-theme').options].map(o => o.value));
  chk('主题下拉里是 跟随系统/浅色/深色 三选', opts.join(',') === 'auto,light,dark', opts.join(','));

  // 通过下拉（会 saveConf）切换，确认选择被持久化到 localStorage
  await page.evaluate(() => {
    const sel = document.getElementById('set-theme');
    sel.value = 'dark'; sel.dispatchEvent(new Event('change'));
  });
  await C.sleep(250);
  const th5 = await page.evaluate(() => ({
    存储: (JSON.parse(localStorage.getItem('chatview.conf') || '{}')).theme,
    实际: document.documentElement.dataset.theme,
    选中: document.getElementById('set-theme').value
  }));
  chk('通过下拉切换后被持久化（下次打开沿用）', th5.存储 === 'dark' && th5.实际 === 'dark' && th5.选中 === 'dark', JSON.stringify(th5));
  await page.evaluate(() => {
    const sel = document.getElementById('set-theme');
    sel.value = 'auto'; sel.dispatchEvent(new Event('change'));
  });

  // 点右上角按钮：从自动切到显式
  await page.evaluate(() => { window.__viewer.setTheme('auto'); });
  await C.sleep(200);
  await page.evaluate(() => document.getElementById('btn-theme').click());
  await C.sleep(200);
  const th6 = await themeProbe();
  chk('点主题按钮会从「跟随系统」切到显式模式', th6.设置 !== 'auto', JSON.stringify(th6));

  await page.evaluate(() => window.__viewer.setTheme('auto'));
  await C.sleep(200);


  // ---------- 6c. 气泡外观 / 自定义头像 / 精确时间戳 ----------
  await page.evaluate(id => window.__viewer.openSession(id), pick.single || pick.biggest);
  await C.sleep(600);
  await page.evaluate(() => document.getElementById('btn-set').click());
  await C.sleep(250);

  const bubbleBg = () => {
    const bub = document.querySelector('#msgs .m.me .bub') || document.querySelector('#msgs .bub');
    return getComputedStyle(bub).backgroundColor;
  };
  const look = await page.evaluate(async () => {
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); };
    set('set-radius', '18');
    set('set-c-me-l', '#123456');          // 浅色模式那一套
    set('set-c-me-d', '#ffcc00');          // 深色模式那一套
    await new Promise(x => setTimeout(x, 250));
    const bub = document.querySelector('#msgs .m.me .bub') || document.querySelector('#msgs .bub');
    const cs = getComputedStyle(bub);
    const conf = JSON.parse(localStorage.getItem('chatview.conf') || '{}');
    return {
      圆角: Math.round(parseFloat(cs.borderTopLeftRadius)),
      当前背景: cs.backgroundColor, 文字: cs.color,
      存下的圆角: conf.radius, 存下的颜色: conf.colors,
      浅色标记: document.getElementById('look-cur-l').textContent
    };
  });
  chk('滑杆能改气泡圆角', look.圆角 === 18, JSON.stringify(look));
  chk('浅色模式下用「浅色」那一套颜色', look.当前背景 === 'rgb(18, 52, 86)', look.当前背景);
  chk('深色气泡自动改用浅色文字', look.文字 === 'rgb(242, 242, 242)', look.文字);
  chk('圆角与两套颜色分别持久化',
    look.存下的圆角 === 18 && look.存下的颜色 && look.存下的颜色.light.me === '#123456' && look.存下的颜色.dark.me === '#ffcc00',
    JSON.stringify(look.存下的颜色));
  chk('面板标出当前生效的是哪一套', /正在用/.test(look.浅色标记), look.浅色标记);

  // 切到深色 → 应自动换成深色那一套（互不影响）
  const lightBg = await page.evaluate(bubbleBg);
  const swap = await page.evaluate(async () => {
    const sel = document.getElementById('set-theme'); sel.value = 'dark'; sel.dispatchEvent(new Event('change'));
    await new Promise(x => setTimeout(x, 400));
    const bub = document.querySelector('#msgs .m.me .bub') || document.querySelector('#msgs .bub');
    const now = getComputedStyle(bub).backgroundColor;
    document.getElementById('btn-set').click();
    await new Promise(x => setTimeout(x, 200));
    return { 现背景: now, 深色输入框: document.getElementById('set-c-me-d').value, 深色标记: document.getElementById('look-cur-d').textContent };
  });
  chk('切到深色模式后自动换成深色那一套颜色', lightBg === 'rgb(18, 52, 86)' && swap.现背景 === 'rgb(255, 204, 0)', lightBg + ' → ' + swap.现背景);
  chk('深色模式下标记当前生效的是深色那套', /正在用/.test(swap.深色标记), swap.深色标记);

  // 各自独立：改深色那套不影响浅色那套
  const indep = await page.evaluate(async () => {
    const el = document.getElementById('set-c-me-d'); el.value = '#00aa88'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change'));
    await new Promise(x => setTimeout(x, 250));
    const conf = JSON.parse(localStorage.getItem('chatview.conf') || '{}');
    return { 浅色套: conf.colors.light.me, 深色套: conf.colors.dark.me };
  });
  chk('改深色那套不影响浅色那套', indep.浅色套 === '#123456' && indep.深色套 === '#00aa88', JSON.stringify(indep));

  // 回到浅色，确认取的是浅色那套
  const back = await page.evaluate(async () => {
    const sel = document.getElementById('set-theme'); sel.value = 'light'; sel.dispatchEvent(new Event('change'));
    await new Promise(x => setTimeout(x, 400));
    const bub = document.querySelector('#msgs .m.me .bub') || document.querySelector('#msgs .bub');
    return getComputedStyle(bub).backgroundColor;
  });
  chk('切回浅色模式取回浅色那一套颜色', back === 'rgb(18, 52, 86)', back);

  const reset = await page.evaluate(async () => {
    document.getElementById('btn-look-reset').click();
    await new Promise(x => setTimeout(x, 300));
    const st = document.documentElement.style;
    return { 圆角: Math.round(parseFloat(getComputedStyle(document.querySelector('#msgs .bub')).borderTopLeftRadius)), 内联覆盖: st.getPropertyValue('--bub-me') };
  });
  chk('「恢复默认」还原圆角与颜色', reset.圆角 === 6 && reset.内联覆盖 === '', JSON.stringify(reset));

  const stampDefault = await page.evaluate(() => document.getElementById('set-stamp').checked);
  chk('时间戳开关默认开启', stampDefault === true, String(stampDefault));

  const stamp = await page.evaluate(async () => {
    const c = document.getElementById('set-stamp'); c.checked = true; c.dispatchEvent(new Event('change'));
    await new Promise(x => setTimeout(x, 500));
    const all = [...document.querySelectorAll('#msgs .tm')].map(e => e.textContent);
    return { 条数: all.length, 首条: all[0] || '', 全为完整时间: all.length > 0 && all.every(t => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(t)),
             悬浮提示: (document.querySelector('#msgs .tm') || {}).getAttribute ? document.querySelector('#msgs .tm').getAttribute('title') : '' };
  });
  chk('精确时间戳开关对每条消息生效', stamp.全为完整时间, JSON.stringify(stamp));

  const stampPos = await page.evaluate(() => {
    const m = document.querySelector('#msgs .m.me') || document.querySelector('#msgs .m');
    const bub = m.querySelector('.bub'), tm = m.querySelector('.tm');
    const rb = bub.getBoundingClientRect(), rt = tm.getBoundingClientRect();
    const cs = getComputedStyle(tm);
    return { 我侧: m.classList.contains('me'), 在气泡下方: rt.top >= rb.bottom - 1,
             与外侧对齐: (m.classList.contains('me') ? Math.abs(rt.right - rb.right) : Math.abs(rt.left - rb.left)) < 2,
             相对气泡: { 气泡: [Math.round(rb.left), Math.round(rb.right), Math.round(rb.bottom)], 时间戳: [Math.round(rt.left), Math.round(rt.right), Math.round(rt.top)] },
             字号: cs.fontSize, 等宽数字: /tabular-nums/.test(cs.fontVariantNumeric), 内容: tm.textContent };
  });
  chk('精确时间戳排在气泡下方、与外侧边缘对齐', stampPos.在气泡下方 && stampPos.与外侧对齐, JSON.stringify(stampPos));
  chk('时间戳样式已生效（10px + 等宽数字）', stampPos.字号 === '10px' && stampPos.等宽数字, stampPos.字号 + ' / 等宽=' + stampPos.等宽数字);

  // 消息之间的时间标记（间隔超过 5 分钟处）也应该是完整精确时间
  const sysMark = await page.evaluate(() => {
    const all = [...document.querySelectorAll('#msgs .sys span')].map(e => e.textContent);
    return { 标记数: all.length, 前几个: all.slice(0, 3), 全为完整时间: all.length > 0 && all.every(x => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(x)) };
  });
  if (sysMark.标记数 > 0) chk('消息之间的时间标记改成完整精确时间', sysMark.全为完整时间, JSON.stringify(sysMark));
  else console.log('（当前会话消息间隔都不足 5 分钟，没有中间时间标记可查）');

  // 关掉开关 → 每条消息旁完全不显示时间；气泡悬停仍能拿到精确时间
  await page.evaluate(() => { const c = document.getElementById('set-stamp'); c.checked = false; c.dispatchEvent(new Event('change')); });
  await C.sleep(500);
  const off = await page.evaluate(() => {
    const bub = document.querySelector('#msgs .m .bub');
    return { 时间戳节点数: document.querySelectorAll('#msgs .tm').length,
             消息数: document.querySelectorAll('#msgs .m').length,
             气泡悬停提示: bub ? bub.getAttribute('title') : null,
             存档值: (JSON.parse(localStorage.getItem('chatview.conf') || '{}')).stamp };
  });
  chk('关掉开关后每条消息旁完全没有时间戳', off.时间戳节点数 === 0 && off.消息数 > 0, JSON.stringify(off));
  chk('时间戳关掉时气泡悬停仍显示精确时间', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(off.气泡悬停提示 || ''), String(off.气泡悬停提示));
  chk('「关闭」这个状态能存下来', off.存档值 === false, String(off.存档值));

  // 再打开，确认开关可来回切
  await page.evaluate(() => { const c = document.getElementById('set-stamp'); c.checked = true; c.dispatchEvent(new Event('change')); });
  await C.sleep(500);
  const backOn = await page.evaluate(() => ({
    时间戳节点数: document.querySelectorAll('#msgs .tm').length,
    全为完整时间: [...document.querySelectorAll('#msgs .tm')].every(e => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(e.textContent))
  }));
  chk('重新打开后时间戳又全都回来（且都是完整时间）', backOn.时间戳节点数 > 0 && backOn.全为完整时间, JSON.stringify(backOn));



  const avName = await page.evaluate(() => { const el = document.querySelector('#msgs .av'); return el ? el.dataset.name : null; });
  if (avName) {
    const av = await page.evaluate(async (name) => {
      const sel = document.getElementById('set-avatar-who');
      sel.value = name; sel.dispatchEvent(new Event('change'));
      const cv = document.createElement('canvas'); cv.width = 4; cv.height = 4;
      cv.getContext('2d').fillRect(0, 0, 4, 4);
      const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
      const dt = new DataTransfer(); dt.items.add(new File([blob], 'a.png', { type: 'image/png' }));
      const inp = document.getElementById('f-avatar'); inp.files = dt.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(x => setTimeout(x, 900));
      return { 已存: !!window.__viewer.S.avatars[name], 是PNG: String(window.__viewer.S.avatars[name] || '').startsWith('data:image/png'),
               聊天里图片数: document.querySelectorAll('#msgs .av img').length, 选中: sel.value };
    }, avName);
    chk('绑定自定义头像后聊天里换成图片', av.已存 && av.是PNG && av.聊天里图片数 > 0, JSON.stringify(av));

    const avc = await page.evaluate(async (name) => {
      document.getElementById('btn-avatar-clear').click();
      await new Promise(x => setTimeout(x, 600));
      return { 已存: !!window.__viewer.S.avatars[name], 聊天里图片数: document.querySelectorAll('#msgs .av img').length };
    }, avName);
    chk('清除头像后回到首字方块', !avc.已存 && avc.聊天里图片数 === 0, JSON.stringify(avc));
  } else chk('绑定自定义头像后聊天里换成图片', false, '没找到可绑定的头像元素');

  // 关掉时间戳，避免影响后面的截图
  await page.evaluate(() => { const c = document.getElementById('set-stamp'); c.checked = false; c.dispatchEvent(new Event('change')); });
  await C.sleep(300);

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
