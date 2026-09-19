/**
 * 界面验证：布局几何、配色、图片、灯箱、搜索跳转、深色模式、设置。
 * 会话按数据特征动态挑选，不依赖任何具体会话名。
 */
const puppeteer = require('puppeteer-core');
const C = require('./_config.js');

const fails = [];
const chk = (n, c, d) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? '  → ' + d : '')); if (!c) fails.push(n); };

/* 像素级测「头像里的字是否居中」：截头像那一小块 → 把 PNG 丢回页面用 canvas 解码 →
   只统计圆内、且「离白色比离底色更近」的像素（文字是白的、底色是彩色），算墨迹包围盒中心与几何中心的偏差。
   这是唯一能真的看出「字偏上/偏下」的办法（getComputedStyle 看不出字形墨迹的位置）。 */
async function inkOffset(page, sel) {
  // 只在「当前视口内」挑一个（不要 scrollIntoView：聊天区滚到顶部会触发「载入更早」把 DOM 重建，
  // 量到的元素就失效了）。挑不到再小幅滚动重试一次。
  const pickOne = () => page.evaluate(s => {
    const vis = [...document.querySelectorAll(s)].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width >= 10 && r.top >= 2 && r.bottom <= innerHeight - 2 && r.left >= -1 && r.right <= innerWidth + 1;
    });
    const el = vis.find(e => e.querySelector('span')) || vis[0];   // 优先带文字的
    if (!el) return null;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el), sp = el.querySelector('span');
    return { x: r.x, y: r.y, w: r.width, h: r.height, bg: cs.backgroundColor,
             fs: sp ? parseFloat(getComputedStyle(sp).fontSize) : null, txt: (sp || el).textContent.trim() };
  }, sel);
  let info = await pickOne();
  if (!info) {
    await page.evaluate(() => { const sc = document.getElementById('scroll'); if (sc && sc.scrollTop > 400) sc.scrollTop -= 400; });
    await new Promise(r => setTimeout(r, 400));
    info = await pickOne();
  }
  if (!info) return null;
  const buf = await page.screenshot({ clip: { x: Math.round(info.x), y: Math.round(info.y), width: Math.round(info.w), height: Math.round(info.h) } });
  const an = await page.evaluate(async ({ b64, bg }) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg); const B = [+m[1], +m[2], +m[3]];
    const cx = (cv.width - 1) / 2, cy = (cv.height - 1) / 2, rad = Math.min(cv.width, cv.height) / 2 - 2;
    let minY = 1e9, maxY = -1, minX = 1e9, maxX = -1, n = 0;
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > rad * rad) continue;                 // 圆外是页面背景，会污染包围盒
      const i = (y * cv.width + x) * 4;
      const dW = Math.abs(d[i] - 255) + Math.abs(d[i+1] - 255) + Math.abs(d[i+2] - 255);
      const dB = Math.abs(d[i] - B[0]) + Math.abs(d[i+1] - B[1]) + Math.abs(d[i+2] - B[2]);
      if (dW < dB - 40) { n++; if (y < minY) minY = y; if (y > maxY) maxY = y; if (x < minX) minX = x; if (x > maxX) maxX = x; }
    }
    return { dy: +(((minY + maxY) / 2) - cy).toFixed(1), dx: +(((minX + maxX) / 2) - cx).toFixed(1), n };
  }, { b64: Buffer.from(buf).toString('base64'), bg: info.bg });
  return { 边长: Math.round(info.w), 字号: info.fs, 占边长: info.fs ? +(info.fs / info.w).toFixed(3) : null, 文本: info.txt, 垂直偏移: an.dy, 水平偏移: an.dx };
}

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
        标记上方间距: (() => {
          const kids = [...document.querySelectorAll('#msgs > *')]; const out = [];
          for (let i = 1; i < kids.length; i++) if (kids[i].classList.contains('sys')) out.push(Math.round(kids[i].getBoundingClientRect().top - kids[i - 1].getBoundingClientRect().bottom));
          return out;
        })(),
        标记下方间距: (() => {
          const kids = [...document.querySelectorAll('#msgs > *')]; const out = [];
          for (let i = 0; i < kids.length - 1; i++) if (kids[i].classList.contains('sys')) out.push(Math.round(kids[i + 1].getBoundingClientRect().top - kids[i].getBoundingClientRect().bottom));
          return out;
        })(),
        阴影: (() => {
          const pick = sel => { const el = document.querySelector(sel); return el ? getComputedStyle(el).boxShadow : null; };
          const o = { 对方文字气泡: pick('#msgs .m:not(.me) .bub'), 我方文字气泡: pick('#msgs .m.me .bub'),
                      图片气泡: pick('#msgs .bub.imgp'), 对方图片气泡: pick('#msgs .m:not(.me) .bub.imgp') };
          o.全部为无 = Object.values(o).every(v => v === null || v === 'none');
          return o;
        })(),
        avGap: (() => { const m = document.querySelector('#msgs .m:not(.me)'); if (!m) return null; const av = m.querySelector('.av'), bb = m.querySelector('.bub'); return av && bb ? Math.round(bb.getBoundingClientRect().left - av.getBoundingClientRect().right) : null; })(),
        相邻消息间距: (() => {
          const kids = [...document.querySelectorAll('#msgs > *')]; const out = [];
          for (let i = 1; i < kids.length; i++) {
            if (!kids[i].classList.contains('m') || !kids[i - 1].classList.contains('m')) continue;   // 中间夹着时间标记的不算
            out.push(Math.round(kids[i].getBoundingClientRect().top - kids[i - 1].getBoundingClientRect().bottom));
          }
          return out;
        })(),
        fontSize: cs(other || document.body).fontSize
      };
    });
    console.log('几何：' + JSON.stringify(geo));
    chk('侧栏宽度已放大(320~380)', geo.side.w >= 320 && geo.side.w <= 380, geo.side.w);
    chk('无横向溢出', !geo.overflowX);
    chk('我方气泡整体靠右、对方靠左', geo.meBox && geo.otherBox &&
      (geo.meBox.x + geo.meBox.w) > (geo.otherBox.x + geo.otherBox.w) && geo.meBox.x > geo.otherBox.x,
      geo.meBox && geo.otherBox ? `me=[${geo.meBox.x},${geo.meBox.x + geo.meBox.w}] other=[${geo.otherBox.x},${geo.otherBox.x + geo.otherBox.w}]` : 'n/a');
    chk('我方气泡是微信绿', geo.meBg === 'rgb(149, 236, 105)', geo.meBg);
    chk('对方气泡是白色', geo.otherBg === 'rgb(255, 255, 255)', geo.otherBg);
    chk('正文字号 14px', geo.fontSize === '14px', geo.fontSize);
    chk('气泡没有阴影（我方/对方/图片气泡都不许有）',
      geo.阴影.全部为无 === true, JSON.stringify(geo.阴影));
    chk('气泡高度均正常', geo.rowHeights.length > 0 && geo.rowHeights.every(h => h > 0), geo.rowHeights.join(','));
    if (geo.标记上方间距.length) {
      const 上 = Math.min(...geo.标记上方间距), 下 = Math.min(...geo.标记下方间距), 消 = Math.min(...geo.相邻消息间距);
      chk('时间块与气泡的间距 > 气泡之间的间距', 上 > 消 && 下 > 消,
        '时间块上方 ' + 上 + 'px / 下方 ' + 下 + 'px vs 气泡之间 ' + 消 + 'px');
    } else console.log('（当前会话没有时间块，跳过时间块间距检查）');
    chk('相邻消息的垂直间距 > 头像与气泡的间距',
      geo.avGap > 0 && geo.相邻消息间距.length > 0 && Math.min(...geo.相邻消息间距) > geo.avGap,
      '消息间距最小 ' + Math.min(...geo.相邻消息间距) + 'px vs 头像↔气泡 ' + geo.avGap + 'px（取 ' + geo.相邻消息间距.slice(0, 5).join('/') + '）');
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
      chk('群聊里有图片消息', grp.imgTags > 0, grp.imgTags + ' 张');
      if (grp.loaded > 0) console.log('  已加载 ' + grp.loaded + '/' + grp.imgTags + '（懒加载，只算已滚到视口内的）');
      else console.log('  （视口内暂无已加载图片 —— 懒加载所致；「真能加载出来」由灯箱那条断言验证）');
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

    // 灯箱里的图是无懒加载的直取，等它真解码出来 —— 这才是「图床真能加载」的确定证据
    const lbLoad = await page.evaluate(async () => {
      const img = document.getElementById('lb-img');
      for (let i = 0; i < 40 && !img.naturalWidth; i++) await new Promise(r => setTimeout(r, 250));
      return { 宽: img.naturalWidth, 高: img.naturalHeight, 来源: img.src.slice(0, 34) };
    });
    chk('大图真实加载出来（不是占位/破图）', lbLoad.宽 > 0 && lbLoad.高 > 0, JSON.stringify(lbLoad));

    const navInk = await page.evaluate(() => {
      const c = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
      const out = {};
      for (const id of ['lb-prev', 'lb-next']) {
        const btn = document.getElementById(id), path = btn.querySelector('svg path');
        const b = c(btn), pth = c(path);
        out[id] = { 水平偏差: +(pth.x - b.x).toFixed(2), 垂直偏差: +(pth.y - b.y).toFixed(2) };
      }
      // 顺带量一下纯文字字形（旧做法）的墨迹偏移，作为对照
      const cv = document.createElement('canvas').getContext('2d');
      cv.font = '30px -apple-system, "Segoe UI", sans-serif';
      const mm = cv.measureText('‹');
      out.旧文字字形垂直偏移 = +((mm.actualBoundingBoxAscent - mm.actualBoundingBoxDescent) / 2).toFixed(2);
      return out;
    });
    chk('箭头墨迹在按钮正中（垂直不再偏）',
      Math.abs(navInk['lb-prev'].垂直偏差) <= 1 && Math.abs(navInk['lb-next'].垂直偏差) <= 1,
      JSON.stringify(navInk));

    const navGeo = await page.evaluate(() => {
      const p = document.getElementById('lb-prev').getBoundingClientRect();
      const n = document.getElementById('lb-next').getBoundingClientRect();
      return {
        上一张: { 距左: Math.round(p.left), 宽: Math.round(p.width), 高: Math.round(p.height), 居中偏差: Math.round(Math.abs((p.top + p.height / 2) - innerHeight / 2)) },
        下一张: { 距右: Math.round(innerWidth - n.right), 宽: Math.round(n.width), 高: Math.round(n.height), 居中偏差: Math.round(Math.abs((n.top + n.height / 2) - innerHeight / 2)) }
      };
    });
    chk('切图按钮贴在页面左右两端、竖直居中、够大',
      navGeo.上一张.距左 <= 40 && navGeo.下一张.距右 <= 40 && navGeo.上一张.居中偏差 <= 2 && navGeo.下一张.居中偏差 <= 2 &&
      navGeo.上一张.宽 >= 48 && navGeo.上一张.高 >= 48, JSON.stringify(navGeo));

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

  // ---------- 5. 搜索页 → 点结果 → 跳转 → 高亮 ----------
  const hits = await page.evaluate(async () => {
    const V = window.__viewer, sleep = ms => new Promise(r => setTimeout(r, ms));
    V.openSearch(); await sleep(200);
    const el = document.getElementById('q'); el.value = '我'; el.dispatchEvent(new Event('input')); await sleep(600);
    return document.querySelectorAll('#sp-hits .hit').length;
  });
  chk('搜索页输入关键词后有结果', hits > 0, hits + ' 条');
  await page.screenshot({ path: C.path.join(C.OUT, 'ui_search.png') });
  await page.evaluate(() => document.querySelector('#sp-hits .hit').click());
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
    const S = window.__viewer.S, s = S.cur;
    const kids = [...document.getElementById('msgs').children];
    const texts = kids.filter(k => k.classList.contains('sys')).map(k => k.textContent.trim());
    // 逐条核对：只有「两条消息不在同一个半整时槽位」时才该有标记。
    // 判定用的是绝对时间的槽位（:00–:29 / :30–:59），不是「间隔多久」——
    // 所以 19:05 → 19:30 这种只隔 25 分钟、但跨过半点的情况也必须有标记。
    const slot = ts => { const d = new Date(ts); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + '#' + Math.floor((d.getHours() * 60 + d.getMinutes()) / 30); };
    const bad = []; let lastTs = 0, sawMark = false, checked = 0, 跨半点短间隔 = 0;
    for (const k of kids) {
      if (k.classList.contains('sys')) { sawMark = true; continue; }
      if (!k.classList.contains('m')) continue;
      const i = +k.id.slice(2), ts = s.msgs[i].ts;
      const gapMin = lastTs ? Math.round((ts - lastTs) / 60000) : null;
      const should = !lastTs || slot(lastTs) !== slot(ts);
      if (should !== sawMark) bad.push({ i, 间隔分钟: gapMin, 应有: should, 实际有: sawMark });
      if (should && gapMin !== null && gapMin < 30) 跨半点短间隔++;
      checked++; lastTs = ts; sawMark = false;
    }
    return { 标记数: texts.length, 核对条数: checked, 违规数: bad.length, 违规: bad.slice(0, 4), 跨半点短间隔,
             格式统一: texts.length > 0 && texts.every(t => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t)),
             不带周几: !texts.some(t => /星期|周[一二三四五六日]/.test(t)),
             无秒: !texts.some(t => /:\d{2}:\d{2}$/.test(t)),
             前几个: texts.slice(0, 3) };
  });
  chk('时间标记统一为「年-月-日 时:分」（不带周几、不到秒）',
    sysMark.格式统一 && sysMark.不带周几 && sysMark.无秒, JSON.stringify({ 前几个: sysMark.前几个, 标记数: sysMark.标记数 }));
  chk('分割按「半整时槽位」判定（不在同一槽位才分割）',
    sysMark.核对条数 > 0 && sysMark.违规数 === 0,
    '核对 ' + sysMark.核对条数 + ' 条，违规 ' + sysMark.违规数 + (sysMark.违规数 ? ' → ' + JSON.stringify(sysMark.违规) : ''));
  chk('确实是按槽位而不是按「间隔 30 分钟」判定',
    sysMark.跨半点短间隔 > 0,
    '有 ' + sysMark.跨半点短间隔 + ' 处「间隔不足 30 分钟但跨过半整时」也插了标记');

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


  // ---------- 9. 侧栏群聊头像拼图 + 光标防护 ----------
  const sideInfo = await page.evaluate(() => {
    const S = window.__viewer.S;
    // 测试里独立算一遍「最晚发过消息的 4 个人」，用来和实际渲染对照
    const expect = s => {
      const out = [], seen = new Set();
      for (let i = s.msgs.length - 1; i >= 0 && out.length < 4; i--) {
        const m = s.msgs[i];
        const nm = m.fromName || (String(m.fromId) === String(S.meId) ? S.meName : '');
        if (!nm || seen.has(nm)) continue;
        seen.add(nm); out.push(nm);
      }
      return out;
    };
    const rows = [...document.querySelectorAll('#list .row')];
    const out = { 群数: 0, 拼图行: 0, 自定义优先: 0, 明细: [] };
    for (const s of S.sessions.filter(x => x.kind === 'GROUP')) {
      out.群数++;
      const row = rows.find(r => r.dataset.id === s.id); if (!row) continue;
      const av = row.querySelector('.av');
      if (S.avatars[s.name]) { out.自定义优先++; continue; }          // 绑定过自定义群头像的，优先显示那张图
      const tiles = [...av.querySelectorAll('[title]')].map(x => x.getAttribute('title'));
      const exp = expect(s).slice(0, 4);
      const r0 = av.getBoundingClientRect();
      const inner = [...av.children].every(c => { const r = c.getBoundingClientRect(); return r.left >= r0.left - 1 && r.right <= r0.right + 1 && r.bottom <= r0.bottom + 1; });
      const 块尺寸 = [...av.querySelectorAll('[title]')].map(x => { const r = x.getBoundingClientRect(); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; });
      const 文字溢出 = [...av.querySelectorAll('[title]')].some(x => {
        const sp = x.querySelector('span'); if (!sp) return false;
        const a = x.getBoundingClientRect(), bb = sp.getBoundingClientRect();
        return bb.width > a.width + 0.5 || bb.height > a.height + 0.5;
      });
      if (tiles.length) out.拼图行++;
      out.明细.push({ 会话: s.name, 期望: exp, 实际: tiles, 尺寸对: Math.round(r0.width) === 47 && Math.round(r0.height) === 47, 未溢出: inner,
                      块尺寸, 文字未溢出: !文字溢出, 全正方形: 块尺寸.every(b => Math.abs(b.w - b.h) <= 1 && b.w > 8) });
    }
    const av0 = document.querySelector('#list .row .av'), cs = av0 ? getComputedStyle(av0) : null;
    const row0 = document.querySelector('#list .row'), rs = row0 ? getComputedStyle(row0) : null;
    out.光标 = cs ? { 头像caret: cs.caretColor, 头像可选: cs.userSelect, 行caret: rs.caretColor, 行可选: rs.userSelect } : null;
    return out;
  });
  const 拼图错 = sideInfo.明细.filter(d => d.实际.length !== d.期望.length || d.实际.join('|') !== d.期望.join('|') || !d.尺寸对 || !d.未溢出);
  chk('群聊标题头像 = 群内最晚发过消息的 4 人拼图（不足 4 人取全部）',
    sideInfo.拼图行 > 0 && 拼图错.length === 0,
    '群 ' + sideInfo.群数 + ' 个 / 拼图 ' + sideInfo.拼图行 + ' 个' + (拼图错.length ? ' 异常：' + JSON.stringify(拼图错) : ' 全部人数与次序一致'));
  if (sideInfo.自定义优先) console.log('  （有 ' + sideInfo.自定义优先 + ' 个群绑定了自定义群头像，按设计优先显示自定义图）');
  chk('群聊拼图头像外框 47x47（侧栏已放大）且子块不溢出', sideInfo.明细.every(d => d.尺寸对 && d.未溢出), JSON.stringify(sideInfo.明细.slice(0, 2)));
  chk('拼图块里的文字不溢出格子', sideInfo.明细.every(d => d.文字未溢出), JSON.stringify(sideInfo.明细.map(d => d.会话 + ':' + d.实际.join('/')).slice(0, 4)));
  chk('拼图里每一块头像都是正方形（不被拉长）', sideInfo.明细.length > 0 && sideInfo.明细.every(d => d.全正方形),
    JSON.stringify(sideInfo.明细.map(d => d.会话 + ':' + d.块尺寸.map(b => b.w + 'x' + b.h).join(',')).slice(0, 6)));
  chk('头像与侧栏行不可选中、光标颜色透明（防文字光标乱入）',
    sideInfo.光标 && sideInfo.光标.头像caret === 'rgba(0, 0, 0, 0)' && sideInfo.光标.头像可选 === 'none'
    && sideInfo.光标.行caret === 'rgba(0, 0, 0, 0)' && sideInfo.光标.行可选 === 'none', JSON.stringify(sideInfo.光标));

  // ---------- 9b. 头像文字取字规则 ----------
  const initials = await page.evaluate(() => {
    const f = window.__viewer.initialOf;
    const cases = [['唐熠嘉', '熠嘉'], ['林小舟', '小舟'], ['陈屿', '陈屿'], ['周乐', '周乐'], ['欧阳娜娜', '欧阳'], ['机器人社技术组', '机器'], ['A', 'A']];
    return cases.map(([n, exp]) => ({ 名字: n, 字数: [...n].length, 取到: f(n), 期望: exp, 正确: f(n) === exp }));
  });
  const 取字错 = initials.filter(x => !x.正确);
  chk('头像文字规则：2 字取全名 / 3 字取后 2 字 / 4 字以上取前 2 字',
    取字错.length === 0, 取字错.length ? JSON.stringify(取字错) : initials.map(x => x.名字 + '→' + x.取到).join('  '));


  {  // 本节变量都收在这个块里，避免和上面的断言重名
  // ---------- 10. 搜索页：正确性 / 覆盖范围 / 性能 / 交互 / 渲染上限 ----------
  const savedSid = await page.evaluate(() => window.__viewer.S.cur ? window.__viewer.S.cur.id : null);
  // 10a. 索引 vs 朴素扫描：集合完全一致（含日期窗口），且按时间从新到旧
  const cmp = await page.evaluate(() => {
    const V = window.__viewer;
    const naive = (q, from, to) => {
      const lq = q.toLowerCase(), out = [];
      for (const s of V.S.sessions) for (let i = 0; i < s.msgs.length; i++) {
        const m = s.msgs[i]; if (!m.text) continue;
        if (m.text.toLowerCase().indexOf(lq) < 0) continue;
        if (from && m.ts < from) continue;
        if (to && m.ts >= to) continue;
        out.push(s.id + '#' + i);
      }
      return out.sort();
    };
    const qs = [];
    for (const s of V.S.sessions.slice(0, 3)) { const m = s.msgs.find(x => x.text && x.text.length > 6); if (m) qs.push(m.text.slice(1, 4)); }
    qs.push('的', 'zzz这个词不存在zzz', 'A');
    const y = new Date().getFullYear(), at = n => new Date(n, 0, 1).getTime();
    const res = [];
    for (const q of qs) for (const w of [[0, 0], [at(y), 0], [0, at(y - 1)]]) {
      V.S.hitCache = new Map();
      const hits = V.findHits(q, w[0], w[1]);
      const fast = hits.map(h => h.s.id + '#' + h.i).sort();
      const slow = naive(q, w[0], w[1]);
      res.push({ q: q.slice(0, 6), 索引: fast.length, 朴素: slow.length,
                 一致: fast.length === slow.length && fast.every((x, k) => x === slow[k]),
                 时间倒序: hits.every((h, k) => k === 0 || hits[k - 1].m.ts >= h.m.ts) });
    }
    return res;
  });
  chk('索引搜索与朴素扫描逐条一致（含日期窗口），且按时间从新到旧',
    cmp.every(x => x.一致 && x.时间倒序), '共 ' + cmp.length + ' 组比对，首组 ' + JSON.stringify(cmp[0]));

  // 10b. 覆盖范围：常见词必须能搜到「数据最老那一段」（原来只命中最近几个会话）
  const cover = await page.evaluate(() => {
    const V = window.__viewer, S = V.S;
    let t0 = Infinity, t1 = -Infinity, n = 0;
    for (const s of S.sessions) for (const m of s.msgs) { n++; if (m.ts < t0) t0 = m.ts; if (m.ts > t1) t1 = m.ts; }
    const d = t => new Date(t).toISOString().slice(0, 10);
    const 老界限 = t0 + (t1 - t0) * 0.2;
    const out = { 消息数: n, 全体范围: [d(t0), d(t1)], 逐词: [] };
    for (const q of ['的', '我']) {
      S.hitCache = new Map();
      const hits = V.findHits(q);
      let mn = Infinity, mx = -Infinity, 老段 = 0;
      for (const h of hits) { if (h.m.ts < mn) mn = h.m.ts; if (h.m.ts > mx) mx = h.m.ts; if (h.m.ts <= 老界限) 老段++; }
      out.逐词.push({ 词: q, 条数: hits.length, 范围: [d(mn), d(mx)], 涉及会话: new Set(hits.map(h => h.s.id)).size, 老段条数: 老段 });
    }
    return out;
  });
  if (cover.消息数 > 20000) {
    chk('常见词能搜到全时间范围（含数据最老那段），不再被 400 上限截断',
      cover.逐词.every(x => x.条数 > 400 && x.老段条数 > 0 && x.涉及会话 >= 20),
      JSON.stringify(cover.逐词) + ' 全体 ' + cover.全体范围.join(' ~ '));
  } else console.log('（样例数据 ' + cover.消息数 + ' 条，覆盖范围断言只在真实数据上跑）');

  // 10c. 性能：索引扫描 + 取消旧缓存后的重复扫描
  const perf = await page.evaluate(() => {
    const V = window.__viewer, qs = ['周', '的', '周二作业', 'zzz没有这个词zzz'], out = [];
    for (const q of qs) {
      V.S.hitCache = new Map();
      let t = performance.now(); const n = V.findHits(q).length;
      const t1 = performance.now() - t;
      t = performance.now(); V.findHits(q);
      out.push({ 词: q, 条数: n, 首次ms: +t1.toFixed(2), 缓存ms: +(performance.now() - t).toFixed(3) });
    }
    return out;
  });
  chk('索引扫描均在 60ms 内，且同词缓存后 < 2ms',
    perf.every(x => x.首次ms < 60 && x.缓存ms < 2), JSON.stringify(perf));

  // 10d. 搜索页交互：入口 / 分类 / 日期 / 最近搜索 / 分批 / 上限 / 取消 / Esc
  const sp = await page.evaluate(async () => {
    const V = window.__viewer, S = V.S;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const $ = id => document.getElementById(id);
    const o = {};
    // 从干净状态开始
    $('sp').classList.remove('on');
    o.入口不在侧栏里= !!document.getElementById('btn-search') && !document.querySelector('#searchwrap #q');
    $('btn-search').click(); await sleep(250);
    o.打开 = $('sp').classList.contains('on');
    o.空词最近搜索 = ($('sp-recent').textContent || '').trim();
    o.占位符 = $('q').placeholder;
    $('q').value = '的'; $('q').dispatchEvent(new Event('input')); await sleep(700);
    o.分类 = [...document.querySelectorAll('.sp-cat')].map(c => c.textContent.replace(/\s+/g, ' ').trim());
    o.首批卡 = document.querySelectorAll('#sp-hits .hit').length;
    o.期望首批 = Math.min(V.HIT_FIRST, S.hits.length);
    o.小标题 = ($('sp-hithead') || {}).textContent || '';
    // 日期：用数据自身的中位时间当上界（自定义），过滤后必须是原结果的子集且变少
    const ts = []; for (const s of S.sessions) for (const m of s.msgs) ts.push(m.ts);
    ts.sort((a, b) => a - b);
    const mid = ts[Math.floor(ts.length * 0.4)];
    const 全部 = S.hits.length;
    S.customFrom = 0; S.customTo = mid;
    $('sp-date').value = 'custom'; $('sp-date').dispatchEvent(new Event('change')); await sleep(600);
    o.自定义 = { 选项: $('sp-date').value, 面板显示: getComputedStyle($('sp-custom')).display !== 'none',
                 过滤后: S.hits.length, 全部, 更少: S.hits.length < 全部,
                 都在范围内: S.hits.every(h => h.m.ts < mid + 864e5), 标签: V.dateLabel() };
    $('sp-date').value = '0'; $('sp-date').dispatchEvent(new Event('change')); await sleep(500);
    o.回不限 = S.hits.length === 全部;
    // 分类
    document.querySelector('.sp-cat[data-cat="session"]').click(); await sleep(400);
    o.只看会话 = { 会话行: document.querySelectorAll('#sp-sess .sp-srow').length, 卡: document.querySelectorAll('#sp-hits .hit').length,
                   提示: ($('sp-more').textContent || '').trim().slice(0, 24),
                   chips: [...document.querySelectorAll('.sp-cat')].map(c => c.textContent.replace(/\s+/g, ' ').trim()) };
    document.querySelector('.sp-cat[data-cat="msg"]').click(); await sleep(400);
    o.只看记录 = { 会话行: document.querySelectorAll('#sp-sess .sp-srow').length, 卡: document.querySelectorAll('#sp-hits .hit').length };
    document.querySelector('.sp-cat[data-cat="all"]').click(); await sleep(400);
    // 下滑加载 + 上限
    const bd = document.querySelector('#sp .sp-body');
    o.上限 = V.HIT_RENDER_MAX;
    for (let k = 0; k < 12 && document.querySelectorAll('#sp-hits .hit').length < V.HIT_RENDER_MAX; k++) {
      bd.scrollTop = 0; await sleep(40); bd.scrollTop = bd.scrollHeight; await sleep(280);
    }
    o.滑到底后 = document.querySelectorAll('#sp-hits .hit').length;
    o.总命中 = S.hits.length;
    o.上限提示 = ($('hitinfo2') || {}).textContent || '';
    o.节点数 = document.getElementsByTagName('*').length;
    // 最近搜索：点过结果后应记下关键词
    V.rememberSearch('的');
    $('q').value = ''; $('q').dispatchEvent(new Event('input')); await sleep(400);
    o.最近有词 = /的/.test($('sp-recent').textContent || '');
    const row = document.querySelector('.sp-recent-row');
    if (row) { row.click(); await sleep(600); }
    o.点最近 = $('q').value;
    $('sp-clear').click(); await sleep(400);
    o.清空后 = { 框: $('q').value, 最近还在: /的/.test($('sp-recent').textContent || '') };
    $('q').value = '的'; $('q').dispatchEvent(new Event('input')); await sleep(600);
    $('sp-cancel').click(); await sleep(200);
    o.取消关闭 = !$('sp').classList.contains('on');
    V.openSearch(); await sleep(300);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(200);
    o.Esc关闭 = !$('sp').classList.contains('on');
    return o;
  });
  chk('搜索页从侧栏入口打开（列表页只留入口，微信式独立整页）', sp.入口不在侧栏里 && sp.打开, JSON.stringify([sp.入口不在侧栏里, sp.打开]));
  const icons = await page.evaluate(() => {
    const V = window.__viewer, sleep = ms => new Promise(r => setTimeout(r, ms));
    V.openSearch(); V.S.recent = ['实验报告']; V.renderSearch();
    const e = document.getElementById('btn-search');
    const r1 = document.querySelector('.sp-recent-row');
    const out = {
      入口是SVG: !!e && e.querySelectorAll('svg').length === 1 && (e.textContent || '').indexOf('🔍') < 0,
      输入框是SVG: document.querySelectorAll('#sp .sp-box svg').length === 1,
      最近项是SVG: !!r1 && r1.querySelectorAll('svg').length === 1,
      空词藏筛选: getComputedStyle(document.querySelector('#sp .sp-filters')).display === 'none'
    };
    V.closeSearch();
    return out;
  });
  chk('搜索页的图标一律用内联 SVG（不用字符/emoji，深色下才不糊）', icons.入口是SVG && icons.输入框是SVG && icons.最近项是SVG, JSON.stringify(icons));
  chk('空关键词时隐藏日期筛选（没词时它没意义）', icons.空词藏筛选, JSON.stringify(icons));
  chk('空词时展示「最近搜索」引导', /输入关键词|最近搜索/.test(sp.空词最近搜索) && /会话、群聊、聊天记录/.test(sp.占位符), sp.空词最近搜索.slice(0, 24));
  chk('分类 chips 带命中数（全部 = 会话 + 聊天记录）', sp.分类.length === 3 && /全部/.test(sp.分类[0]) && /聊天记录/.test(sp.分类[2]), JSON.stringify(sp.分类));
  chk('首批只渲染 ' + sp.期望首批 + ' 张卡（打字不卡的关键）',
    sp.首批卡 === sp.期望首批 && sp.首批卡 <= 60, JSON.stringify([sp.首批卡, sp.期望首批]));
  chk('聊天记录小标题带条数与时间跨度', /聊天记录（/.test(sp.小标题) && /\d{4}-\d\d-\d\d ~ \d{4}-\d\d-\d\d/.test(sp.小标题), sp.小标题.slice(0, 60));
  chk('日期筛选：自定义区间生效、结果都在区间内且变少，回「不限」后复原',
    sp.自定义.过滤后 > 0 && sp.自定义.更少 && sp.自定义.都在范围内 && sp.自定义.面板显示 && sp.回不限,
    JSON.stringify(sp.自定义));
  chk('分类切换：只看会话时不出消息卡，只看记录时不列会话',
    sp.只看会话.卡 === 0 && sp.只看记录.会话行 === 0 && sp.只看记录.卡 > 0, JSON.stringify([sp.只看会话, sp.只看记录]));
  chk('会话分类下没结果时给出提示，且 chips 上仍保留消息命中数',
    /没有会话名匹配/.test(sp.只看会话.提示) && /聊天记录 \d/.test(sp.只看会话.chips.join(' ')),
    JSON.stringify([sp.只看会话.提示, sp.只看会话.chips]));
  chk('下滑加载到 min(上限, 总命中)，DOM 里最多留 ' + sp.上限 + ' 张卡（不再越滑越卡）',
    sp.滑到底后 === Math.min(sp.上限, sp.总命中) && sp.滑到底后 <= sp.上限 && sp.节点数 < 12000,
    JSON.stringify([sp.滑到底后, '总命中 ' + sp.总命中, '节点 ' + sp.节点数, sp.上限提示.slice(0, 30)]));
  chk('最近搜索：能记下关键词、点一下能回填搜索框', sp.最近有词 && sp.点最近 === '的', JSON.stringify([sp.最近有词, sp.点最近]));
  chk('清空按钮只清输入、不删最近搜索', sp.清空后.框 === '' && sp.清空后.最近还在, JSON.stringify(sp.清空后));
  chk('「取消」与 Esc 都能关搜索页', sp.取消关闭 && sp.Esc关闭, JSON.stringify([sp.取消关闭, sp.Esc关闭]));

  // 10e. 打字性能预算：每次按键的 Script+Layout 不该失控（原来每键都要重建整个侧栏）
  const budget = await page.evaluate(async () => {
    const V = window.__viewer;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const m = () => performance.now();
    document.getElementById('btn-search').click(); await sleep(300);
    const typed = '今天下午的作业好多啊';
    let worst = 0, total = 0, n = 0;
    for (let k = 1; k <= typed.length; k++) {
      const t = m();
      const el = document.getElementById('q'); el.value = typed.slice(0, k); el.dispatchEvent(new Event('input'));
      await sleep(160);
      const dt = m() - t;                     // 包含防抖后的渲染
      total += dt; n++; if (dt > worst) worst = dt;
    }
    document.getElementById('sp-cancel').click();
    return { 次数: n, 平均ms: +(total / n).toFixed(1), 最差ms: +worst.toFixed(1), 卡片: document.querySelectorAll('#sp-hits .hit').length };
  });
  chk('连打 10 个字的平均回帧 < 260ms（含 130ms 防抖等待）', budget.平均ms < 260, JSON.stringify(budget));

  // 10f. 搜索不再改动侧栏列表（原来每敲一个字都重建 80 行侧栏，是卡顿主因）
  const sideNotTouched = await page.evaluate(async () => {
    const V = window.__viewer, sleep = ms => new Promise(r => setTimeout(r, ms));
    const rows = () => document.querySelectorAll('#list .row').length;
    V.closeSearch(); V.S.tab = 'chat'; V.renderSidebar();
    const before = rows();
    V.openSearch(); await sleep(150);
    const el = document.getElementById('q'); el.value = '的'; el.dispatchEvent(new Event('input')); await sleep(600);
    const after = rows();
    const title = document.getElementById('side-title').textContent;
    V.closeSearch();
    return { before, after, title, 全部会话: V.S.sessions.length };
  });
  chk('搜索不打乱侧栏（会话数不变、标题仍是总数）',
    sideNotTouched.before === sideNotTouched.after && sideNotTouched.after === sideNotTouched.全部会话 && /共 .* 个会话/.test(sideNotTouched.title),
    JSON.stringify(sideNotTouched));

  // ---------- 11. 会话内：按发言人筛选 ----------
  const flt = await page.evaluate(async () => {
    const V = window.__viewer, S = V.S;
    const s = V.sortedSessions().find(x => Object.keys(x.senders).length >= 2) || V.sortedSessions()[0];
    V.openSession(s.id);
    await new Promise(r => setTimeout(r, 400));
    const top = Object.entries(s.senders).sort((a, b) => b[1] - a[1])[0];
    V.togglePpl();
    const rows = [...document.querySelectorAll('#ppl .ppl-row')];
    const out = { 会话: s.name, 发言人: Object.keys(s.senders).length, 下拉行数: rows.length, 最多者: top, 首行是全部: rows[0].dataset.all === '1' };
    const target = rows.find(r => r.dataset.nm === top[0]);
    out.找到目标行 = !!target;
    target.click();
    await new Promise(r => setTimeout(r, 500));
    const rendered = [...document.querySelectorAll('#msgs .m')];
    out.筛选后 = {
      筛选名: S.filterName, 视图条数: V.viewLen(), 期望条数: top[1],
      渲染条数: rendered.length,
      渲染全是该发言人: rendered.every(el => (s.msgs[+el.id.slice(2)].fromName || '') === top[0]),
      头部带只看: /只看/.test(document.getElementById('hd-meta').textContent),
      取消按钮: !!document.getElementById('btn-unfilter'),
      下拉已收: !document.getElementById('ppl'),
      图片也受限: V.sessionImages().every(it => (s.msgs[it.i].fromName || '') === top[0])
    };
    // 取消筛选
    document.getElementById('btn-unfilter').click();
    await new Promise(r => setTimeout(r, 400));
    out.取消后 = { 视图: S.view, 筛选名: S.filterName, 渲染条数: document.querySelectorAll('#msgs .m').length, 无取消按钮: !document.getElementById('btn-unfilter') };
    // 换会话应自动清掉筛选
    const other = V.sortedSessions().find(x => x.id !== s.id);
    V.filterBySender(top[0]);
    out.再次筛选 = { 条数: V.viewLen() };
    V.openSession(other.id);
    await new Promise(r => setTimeout(r, 300));
    out.换会话后 = { 视图: S.view, 筛选名: S.filterName, 头部无只看: !/只看/.test(document.getElementById('hd-meta').textContent) };
    return out;
  });
  chk('会话内可按发言人筛选：下拉列出全部发言人并显示条数',
    flt.下拉行数 === flt.发言人 + 1 && flt.首行是全部 && flt.找到目标行, JSON.stringify({ 会话: flt.会话, 发言人: flt.发言人, 下拉行数: flt.下拉行数 }));
  chk('筛选后只渲染该发言人的消息，且条数与统计一致',
    flt.筛选后.视图条数 === flt.筛选后.期望条数 && flt.筛选后.渲染全是该发言人 && flt.筛选后.渲染条数 === Math.min(250, flt.筛选后.期望条数)
    && flt.筛选后.头部带只看 && flt.筛选后.取消按钮 && flt.筛选后.下拉已收,
    JSON.stringify(flt.筛选后));
  chk('筛选可取消，换会话会自动清掉筛选',
    flt.取消后.视图 === null && flt.取消后.筛选名 === null && flt.取消后.无取消按钮 && flt.换会话后.视图 === null && flt.换会话后.头部无只看,
    JSON.stringify({ 取消后: flt.取消后, 再次筛选: flt.再次筛选, 换会话后: flt.换会话后 }));

  // ---------- 12. 会话内：图片画廊 ----------
  const gal = await page.evaluate(async () => {
    const V = window.__viewer, S = V.S;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const imgN = x => x.msgs.reduce((a, m) => a + (m.url ? 1 : 0), 0);
    const s = V.sortedSessions().slice().sort((a, b) => imgN(b) - imgN(a))[0];   // 取图片最多的会话
    V.openSession(s.id);
    await sleep(600);
    // 样例数据图片太少，验证不了「分批 + 上滑续载」；临时克隆图片消息凑够 300 张，测完还原
    let injected = 0;
    if (V.sessionImages().length < 121 && V.sessionImages().length > 0) {
      const proto = s.msgs.find(x => x.url), base = V.sessionImages()[0].ts;
      const before = s.msgs.length;
      for (let k = 0; k < 300; k++) { const m = Object.assign({}, proto); m.ts = base + k * 1000; s.msgs.push(m); }
      s.n = s.msgs.length;
      injected = s.msgs.length - before;
      V.openSession(s.id);
      await sleep(600);
    }
    const total = V.sessionImages().length;
    V.openGallery();
    await sleep(900);
    const g = $('gal'), grid = $('gal-grid'), body = $('gal-body');
    const cells = () => [...body.querySelectorAll('.gal-cell')];
    const at = c => +c.dataset.at;
    const rectsOf = () => cells().map(c => c.getBoundingClientRect());
    const 重叠对 = rs => {           // 两两求交：任何两格相交都算重叠
      let n = 0;
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i], b = rs[j];
        if (a.left < b.right - .5 && b.left < a.right - .5 && a.top < b.bottom - .5 && b.top < a.bottom - .5) n++;
      }
      return n;
    };
    const c0 = cells(), r0 = rectsOf();
    const out = { 会话: s.name, 本会话图数: total, 首批格子: c0.length, 期望首批: Math.min(120, total),
                  最旧下标: c0.length ? at(c0[0]) : null, 最新下标: c0.length ? at(c0[c0.length - 1]) : null,
                  期望最旧下标: Math.max(0, total - 120),
                  初始停在底部: grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 4,
                  重叠对: 重叠对(r0), 全正方形: r0.every(r => Math.abs(r.width - r.height) <= 1 && r.width > 40),
                  底色: getComputedStyle(g).backgroundColor,
                  顶部提示: $('gal-head').textContent.trim(), 还有更早: total > c0.length };
    if (out.还有更早) {            // 往上滑 → 自动加载更早的，且画面不能跳
      const h0 = grid.scrollHeight;
      grid.scrollTop = 100;        // 进入顶部阈值 → 触发加载
      await sleep(900);
      const c1 = cells(), h1 = grid.scrollHeight;
      out.上滑后格子 = c1.length;
      out.上滑后最旧下标 = at(c1[0]);
      out.上滑后重叠对 = 重叠对(rectsOf());
      out.上滑后顶部提示 = $('gal-head').textContent.trim();
      out.顺序上旧下新 = c1.every((c, k) => at(c) === at(c1[0]) + k);
      out.画面没跳 = { 期望scrollTop: 100 + (h1 - h0), 实际: +grid.scrollTop.toFixed(1), 差: +(grid.scrollTop - (100 + (h1 - h0))).toFixed(1) };
    }
    const last = cells()[cells().length - 1];       // 点最新那张（在最下面）
    out.点的是最新 = at(last) === total - 1;
    last.click();
    await sleep(700);
    out.点缩略图后 = { 画廊关: !g.classList.contains('on'), 灯箱开: document.getElementById('lb').classList.contains('on'),
                       计数: document.getElementById('lb-pos').textContent };
    V.closeLB();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(200);
    out.Esc后画廊关 = !g.classList.contains('on');
    if (injected) {                       // 还原临时注入的消息，别影响后面的小节
      s.msgs.length = s.n - injected; s.n = s.msgs.length;
      V.openSession(s.id);
      await sleep(300);
    }
    out.注入了临时图片 = injected;
    return out;
  });
  chk('图片画廊：正方形格子 + 不重叠，一打开停在最底部（最新那批）',
    gal.首批格子 === gal.期望首批 && gal.首批格子 > 0 && gal.重叠对 === 0 && gal.全正方形 && gal.初始停在底部
    && gal.最旧下标 === gal.期望最旧下标 && gal.最新下标 === gal.本会话图数 - 1,
    JSON.stringify({ 会话: gal.会话, 图数: gal.本会话图数, 首批: gal.首批格子, 下标: [gal.最旧下标, gal.最新下标], 重叠对: gal.重叠对, 停在底部: gal.初始停在底部 }));
  chk('画廊底色不透明（不会透出后面的聊天，看着像重叠）',
    /^rgb\(/.test(gal.底色) && !/rgba/.test(gal.底色), gal.底色);
  chk('往上滑自动加载更早的图片，加载后画面不跳、顺序仍是上旧下新',
    !gal.还有更早 || (gal.上滑后格子 > gal.首批格子 && gal.上滑后最旧下标 < gal.最旧下标
                      && gal.上滑后重叠对 === 0 && gal.顺序上旧下新 && Math.abs(gal.画面没跳.差) <= 2),
    JSON.stringify({ 还有更早: gal.还有更早, 上滑后: gal.上滑后格子, 最旧下标: gal.上滑后最旧下标, 顶部提示: gal.上滑后顶部提示, 顺序: gal.顺序上旧下新, 画面没跳: gal.画面没跳 }));
  chk('点最新那张缩略图直接进灯箱、Esc 关闭',
    gal.点的是最新 && gal.点缩略图后.画廊关 && gal.点缩略图后.灯箱开 && /^\d+ \/ \d+$/.test(gal.点缩略图后.计数) && gal.Esc后画廊关,
    JSON.stringify({ 点的是最新: gal.点的是最新, 点后: gal.点缩略图后, Esc: gal.Esc后画廊关 }));

  // ---------- 12b. 层级：从画廊点进图片详情，关闭只退一层（回画廊） ----------
  const lay = await page.evaluate(async () => {
    const V = window.__viewer, S = V.S;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const $ = id => document.getElementById(id);
    const imgN = x => x.msgs.reduce((a, m) => a + (m.url ? 1 : 0), 0);
    const s = V.sortedSessions().slice().sort((a, b) => imgN(b) - imgN(a))[0];
    V.openSession(s.id);
    await sleep(600);
    // 同样临时克隆图片消息凑够 300 张，让「滚动位置还原」这个断言真的有意义
    let injected = 0;
    if (V.sessionImages().length < 121 && V.sessionImages().length > 0) {
      const proto = s.msgs.find(x => x.url), base = V.sessionImages()[0].ts, before = s.msgs.length;
      for (let k = 0; k < 300; k++) { const m = Object.assign({}, proto); m.ts = base + k * 1000; s.msgs.push(m); }
      s.n = s.msgs.length; injected = s.msgs.length - before;
      V.openSession(s.id); await sleep(600);
    }
    const out = { 会话: s.name, 图数: V.sessionImages().length };

    // ① 从「会话里点图」进灯箱 → 关掉后不应冒出画廊
    const w = document.querySelector('#msgs .imgwrap');
    out.会话里有图 = !!w;
    if (w) {
      w.click(); await sleep(600);
      out.从会话进灯箱 = { 灯箱开: $('lb').classList.contains('on'), 画廊关: !$('gal').classList.contains('on') };
      $('lb-close').click(); await sleep(400);
      out.从会话关掉后 = { 灯箱关: !$('lb').classList.contains('on'), 画廊没冒出来: !$('gal').classList.contains('on') };
    }

    // ② 从画廊点缩略图 → 关灯箱只退一层，回到画廊
    V.openGallery(); await sleep(900);
    const grid = $('gal-grid');
    grid.scrollTop = 0;                            // 先上滑触发续载，制造一个非零滚动位置
    await sleep(800);
    const before = { 格子: document.querySelectorAll('#gal .gal-cell').length, scrollTop: Math.round(grid.scrollTop) };
    const cells = [...document.querySelectorAll('#gal .gal-cell')];
    const pick = cells[5] || cells[0];
    out.点的下标 = +pick.dataset.at; out.加载过一批 = before.格子;
    pick.click(); await sleep(700);
    out.进详情 = { 灯箱开: $('lb').classList.contains('on'), 画廊关: !$('gal').classList.contains('on'), 计数: $('lb-pos').textContent };
    $('lb-close').click(); await sleep(500);
    out.点关闭 = { 灯箱关: !$('lb').classList.contains('on'), 回到画廊: $('gal').classList.contains('on'),
                   格子没重建: document.querySelectorAll('#gal .gal-cell').length === before.格子,
                   滚动位置还原: Math.round(grid.scrollTop) - before.scrollTop };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(300);
    out.再按Esc = { 画廊关: !$('gal').classList.contains('on'), 灯箱关: !$('lb').classList.contains('on') };

    // ③ 在灯箱里按 Esc 也应退回画廊
    V.openGallery(); await sleep(700);
    [...document.querySelectorAll('#gal .gal-cell')][0].click(); await sleep(600);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(400);
    out.灯箱里按Esc = { 回画廊: $('gal').classList.contains('on'), 灯箱关: !$('lb').classList.contains('on') };
    V.closeGallery(); V.closeLB();
    out.注入了临时图片 = injected;
    if (injected) { s.msgs.length = s.n - injected; s.n = s.msgs.length; V.openSession(s.id); await sleep(300); }
    return out;
  });
  chk('从会话里点图进灯箱，关掉后不会莫名冒出画廊',
    !lay.会话里有图 || (lay.从会话进灯箱.灯箱开 && lay.从会话进灯箱.画廊关 && lay.从会话关掉后.灯箱关 && lay.从会话关掉后.画廊没冒出来),
    JSON.stringify(lay.从会话进灯箱) + ' → ' + JSON.stringify(lay.从会话关掉后));
  chk('画廊点进图片详情后，关闭只退一层回到画廊（不是一路退回会话）',
    lay.进详情.灯箱开 && lay.进详情.画廊关 && lay.进详情.计数 === (lay.点的下标 + 1) + ' / ' + lay.图数
    && lay.点关闭.灯箱关 && lay.点关闭.回到画廊 && lay.点关闭.格子没重建 && lay.点关闭.滚动位置还原 === 0
    && lay.再按Esc.画廊关 && lay.再按Esc.灯箱关,
    JSON.stringify({ 图数: lay.图数, 已加载: lay.加载过一批, 下标: lay.点的下标, 计数: lay.进详情.计数, 关闭后: lay.点关闭, 再按Esc: lay.再按Esc }));
  chk('在灯箱里按 Esc 同样只退回画廊一层',
    lay.灯箱里按Esc.回画廊 && lay.灯箱里按Esc.灯箱关, JSON.stringify(lay.灯箱里按Esc));

  // ---------- 13. 头像：个人圆形 + 群聊拼图内也圆形 + 只改颜色 ----------
  const av = await page.evaluate(async () => {
    const V = window.__viewer, S = V.S;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const $ = id => document.getElementById(id);
    const cs = el => el ? getComputedStyle(el) : null;
    const R = sel => { const el = document.querySelector(sel); return el ? cs(el).borderRadius : null; };

    $('btn-set').click();                       // 打开设置（正常入口）
    await sleep(400);
    // 优先选「群里出现的人」——这样聊天头像和拼图小块都能验到同一个人
    const tile0 = document.querySelector('#list .row .av.gr [title]');
    const who = tile0 ? tile0.getAttribute('title')
      : Object.entries(S.sessions.reduce((a, s) => { for (const m of s.msgs) a[m.fromName] = (a[m.fromName] || 0) + 1; return a; }, {}))
        .sort((x, y) => y[1] - x[1])[0][0];
    const tileOf = n => [...document.querySelectorAll('#list .row .av.gr [title]')].find(t => t.getAttribute('title') === n);
    const sel = $('set-avatar-who');
    sel.value = who; sel.dispatchEvent(new Event('change'));
    await sleep(300);
    const sess = S.sessions.find(x => x.msgs.some(m => (m.fromName || '') === who)) || S.sessions[0];
    V.openSession(sess.id);
    await sleep(500);

    const out = { 会话: sess.name, 选中: who, 自动配色: V.colorOf(who),
                };

    // ① 圆形：聊天/侧栏/设置预览 = 圆；拼图外框仍是圆角方形、拼图内头像 = 圆
    out.圆形 = {
      聊天: R('#msgs .m .av'), 侧栏私聊: R('#list .row .av:not(.gr)'), 设置预览: R('#avatar-preview > .av'),
      拼图外框: R('#list .row .av.gr'), 拼图内头像: R('#list .row .av.gr [title] > div')
    };
    out.拼图外框仍是圆角方形 = out.圆形.拼图外框 !== '50%' && parseFloat(out.圆形.拼图外框) > 0;

    // ② 只改颜色
    const inp = $('set-avatar-color');
    out.颜色框 = { 可用: !inp.disabled, 初值: inp.value, 初值等于自动配色: inp.value.toLowerCase() === V.colorOf(who).toLowerCase() };
    inp.value = '#ff00aa'; inp.dispatchEvent(new Event('input'));
    await sleep(500);
    const mEl = [...document.querySelectorAll('#msgs .m')].find(el => (S.cur.msgs[+el.id.slice(2)].fromName || '') === who);
    const conf = JSON.parse(localStorage.getItem('chatview.conf') || '{}');
    out.改色后 = {
      colorOf: V.colorOf(who), 记在状态里: S.avatarColors[who],
      聊天头像底色: mEl ? cs(mEl.querySelector('.av')).backgroundColor : null,
      拼图里那个人的圆: (() => { const tt = tileOf(who); const c = tt && tt.firstElementChild; return c ? cs(c).backgroundColor : null; })(),
      拼图块里是不是图片: (() => { const tt = tileOf(who); return tt ? !!tt.querySelector('img') : null; })(),
      存进浏览器: conf.avatarColors ? conf.avatarColors[who] : null
    };
    $('btn-avatar-color-reset').click();
    await sleep(500);
    out.恢复自动 = { colorOf还原: V.colorOf(who) === out.自动配色, 状态里已删: !Object.prototype.hasOwnProperty.call(S.avatarColors, who) };

    // ③ 上传的头像不受影响（改色不动图片）
    S.avatars[who] = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    V.refreshAvatars(); await sleep(400);
    inp.value = '#123456'; inp.dispatchEvent(new Event('input'));
    await sleep(500);
    const mEl2 = [...document.querySelectorAll('#msgs .m')].find(el => (S.cur.msgs[+el.id.slice(2)].fromName || '') === who);
    out.图片与颜色并存 = {
      头像图片还在: !!S.avatars[who],
      聊天里是图片: mEl2 ? !!mEl2.querySelector('.av img') : null,
      颜色也记下了: S.avatarColors[who] === '#123456'
    };
    // 清理
    delete S.avatars[who]; delete S.avatarColors[who];
    document.getElementById('btn-avatar-clear').click();   // 走正常清除路径
    V.refreshAvatars(); await sleep(300);
    $('dlg').classList.remove('on');
    await sleep(300);
    return out;
  });
  console.log('  头像节诊断：' + JSON.stringify(av.诊断));
  chk('个人头像全部改成圆形（聊天、侧栏私聊、设置预览）',
    av.圆形.聊天 === '50%' && av.圆形.侧栏私聊 === '50%' && av.圆形.设置预览 === '50%', JSON.stringify(av.圆形));
  chk('群聊拼图：外框仍是圆角正方形，里面的用户头像变成圆',
    av.拼图外框仍是圆角方形 && av.圆形.拼图内头像 === '50%', JSON.stringify({ 外框: av.圆形.拼图外框, 内头像: av.圆形.拼图内头像 }));
  chk('可以只改头像颜色：生效于聊天与拼图、存进浏览器、可恢复自动配色',
    av.颜色框.可用 && av.颜色框.初值等于自动配色
    && av.改色后.colorOf === '#ff00aa' && av.改色后.聊天头像底色 === 'rgb(255, 0, 170)'
    && av.改色后.拼图里那个人的圆 === 'rgb(255, 0, 170)' && av.改色后.存进浏览器 === '#ff00aa'
    && av.恢复自动.colorOf还原 && av.恢复自动.状态里已删,
    JSON.stringify(av.改色后) + ' / 恢复: ' + JSON.stringify(av.恢复自动));
  chk('改颜色不影响已上传的头像图片（两者能并存）',
    av.图片与颜色并存.头像图片还在 && av.图片与颜色并存.聊天里是图片 && av.图片与颜色并存.颜色也记下了,
    JSON.stringify(av.图片与颜色并存));

  // ---------- 13b. 头像文字：字号相对更小 + 像素级居中 ----------
  const ink = {
    聊天: await inkOffset(page, '#msgs .m .av'),
    侧栏私聊: await inkOffset(page, '#list .row .av:not(.gr)'),
    拼图格内: await inkOffset(page, '#list .row .av.gr [title] > div'),
    侧栏行头像边长: await page.evaluate(() => { const av = document.querySelector('#list .row .av:not(.gr)'); return av ? Math.round(av.getBoundingClientRect().width) : null; })
  };
  // 容差 1px：小字号（9~14px）下字形墨迹会被量化到整数像素行，±0.5px 是测量极限、个别字形到 1px
  chk('头像里的字真的在正中央（像素级：墨迹中心与几何中心偏差 ≤1px）',
    [ink.聊天, ink.侧栏私聊, ink.拼图格内].every(x => x && Math.abs(x.垂直偏移) <= 1 && Math.abs(x.水平偏移) <= 0.5),
    JSON.stringify(ink));
  const ratios = [ink.聊天 && ink.聊天.占边长, ink.侧栏私聊 && ink.侧栏私聊.占边长, ink.拼图格内 && ink.拼图格内.占边长];
  chk('头像文字与头像的比例：两处环境尽量一致（都在 0.30~0.40，彼此差 ≤0.06）',
    ratios.every(r => r !== null) && ratios.every(r => r >= 0.30 && r <= 0.40)
    && Math.max(...ratios) - Math.min(...ratios) <= 0.06,
    JSON.stringify({ 聊天: ratios[0], 侧栏私聊: ratios[1], 拼图格内: ratios[2], 极差: +(Math.max(...ratios) - Math.min(...ratios)).toFixed(3) })
    + ' 字号：' + JSON.stringify([ink.聊天 && ink.聊天.字号, ink.侧栏私聊 && ink.侧栏私聊.字号, ink.拼图格内 && ink.拼图格内.字号]));
  chk('侧栏行头像放大到 47px（拼图小格随之为整数 23px，格内文字更清楚）',
    ink.侧栏行头像边长 === 47, ink.侧栏行头像边长);

  // ---------- 14. 按钮类控件：文字不可选中 + 指针与用途/状态对应 ----------
  const ctrls = await page.evaluate(async () => {
    const V = window.__viewer, S = V.S;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const cs = el => getComputedStyle(el);
    const rows = [];
    const add = (控件, el, 期望指针) => rows.push({ 控件, 存在: !!el, 可选: el ? cs(el).userSelect : null, 指针: el ? cs(el).cursor : null, 期望指针 });
    const $ = id => document.getElementById(id);

    V.openGallery(); await sleep(400);
    $('btn-set').click(); await sleep(400);
    add('顶栏按钮', $('btn-set'), 'pointer');
    add('侧栏列表标签', document.querySelector('#tabs .tab'), 'pointer');
    add('侧栏搜索入口', document.getElementById('btn-search'), 'pointer');
    add('搜索页分类段', document.querySelector('#sp .sp-cat') || document.querySelector('#sp-cats'), 'pointer');
    add('搜索页取消', document.getElementById('sp-cancel'), 'pointer');
    add('侧栏会话行', document.querySelector('#list .row'), 'pointer');
    add('设置里的开关标签', document.querySelector('#dlg label.inline'), 'pointer');
    add('命中卡片', document.querySelector('#hits .hit'), 'pointer');
    add('画廊缩略图', document.querySelector('#gal .gal-cell'), 'zoom-in');
    add('聊天里的图片', document.querySelector('#msgs .imgwrap'), 'zoom-in');
    const dis = document.createElement('button'); dis.disabled = true; dis.textContent = '禁用';
    $('dlg').appendChild(dis); await sleep(50);
    add('禁用的按钮', dis, 'not-allowed');
    dis.remove();
    add('搜索输入框（应保持 text，且文字可选）', $('q'), 'text');
    V.closeGallery(); $('dlg').classList.remove('on');
    await sleep(200);
    const w = document.querySelector('#msgs .imgwrap');
    if (w) {
      w.click(); await sleep(600);
      add('灯箱切图按钮', $('lb-next'), 'pointer');
      add('灯箱关闭按钮', $('lb-close'), 'pointer');
      V.closeLB();
    }
    // 「发言人」下拉行
    if (S.cur) { V.togglePpl(); await sleep(300); add('发言人下拉行', document.querySelector('#ppl .ppl-row'), 'pointer'); V.togglePpl(); }
    return rows;
  });
  const 是输入框 = r => r.控件.indexOf('搜索输入框') === 0;
  const 控件错 = ctrls.filter(r => r.存在 && !是输入框(r) && (r.可选 !== 'none' || r.指针 !== r.期望指针));
  const 输入框 = ctrls.find(r => r.控件.indexOf('搜索输入框') === 0);
  chk('按钮类控件的文字都不可选中（输入框除外）',
    ctrls.filter(r => r.存在 && r.控件.indexOf('搜索输入框') < 0).length >= 7
    && 控件错.length === 0 && 输入框 && 输入框.可选 !== 'none',
    JSON.stringify(控件错.length ? 控件错 : ctrls.map(r => r.控件 + '=' + r.指针 + '/' + r.可选)));

  // 收尾：恢复进入本节前的会话与干净状态
  await page.evaluate(async id => {
    const V = window.__viewer;
    V.closeGallery(); V.closeLB(); V.filterBySender(null);
    V.S.tab = 'chat'; V.syncSideTabs(); V.S.q = ''; document.getElementById('q').value = '';
    if (id) V.openSession(id);
    await new Promise(r => setTimeout(r, 300));
  }, savedSid);
  }

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
