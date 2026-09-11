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

  const look = await page.evaluate(async () => {
    const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); };
    set(document.getElementById('set-radius'), '18');
    set(document.getElementById('set-c-me'), '#123456');
    await new Promise(x => setTimeout(x, 250));
    const bub = document.querySelector('#msgs .m.me .bub') || document.querySelector('#msgs .bub');
    const cs = getComputedStyle(bub);
    return {
      圆角: Math.round(parseFloat(cs.borderTopLeftRadius)),
      背景: cs.backgroundColor, 文字: cs.color,
      存下的圆角: (JSON.parse(localStorage.getItem('chatview.conf') || '{}')).radius
    };
  });
  chk('滑杆能改气泡圆角', look.圆角 === 18, JSON.stringify(look));
  chk('自定义我方气泡颜色生效', look.背景 === 'rgb(18, 52, 86)', look.背景);
  chk('深色气泡自动改用浅色文字', look.文字 === 'rgb(242, 242, 242)', look.文字);
  chk('外观设置被持久化', look.存下的圆角 === 18, look.存下的圆角);

  const reset = await page.evaluate(async () => {
    document.getElementById('btn-look-reset').click();
    await new Promise(x => setTimeout(x, 300));
    const st = document.documentElement.style;
    return { 圆角: Math.round(parseFloat(getComputedStyle(document.querySelector('#msgs .bub')).borderTopLeftRadius)), 内联覆盖: st.getPropertyValue('--bub-me') };
  });
  chk('「恢复默认」还原圆角与颜色', reset.圆角 === 6 && reset.内联覆盖 === '', JSON.stringify(reset));

  const stamp = await page.evaluate(async () => {
    const c = document.getElementById('set-stamp'); c.checked = true; c.dispatchEvent(new Event('change'));
    await new Promise(x => setTimeout(x, 500));
    const all = [...document.querySelectorAll('#msgs .tm')].map(e => e.textContent);
    return { 条数: all.length, 首条: all[0] || '', 全为完整时间: all.length > 0 && all.every(t => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(t)),
             悬浮提示: (document.querySelector('#msgs .tm') || {}).getAttribute ? document.querySelector('#msgs .tm').getAttribute('title') : '' };
  });
  chk('精确时间戳开关对每条消息生效', stamp.全为完整时间, JSON.stringify(stamp));

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
