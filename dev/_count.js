/**
 * 统计工具：看一批导出记录里有多少会话、多少消息、都是什么类型、谁是「我」。
 *   CHAT_DIR=/path/to/records node _count.js
 */
const C = require('./_config.js');
const { extractArray } = require('./_parse.js');

const types = { TEXT: 0, IMAGE: 0, NOTE: 0, OTHER: 0 };
const senders = {};            // 昵称 -> 条数
const ids = {};                // fromId -> 昵称（统计「我」用）
const mineInSingle = {};       // 私聊里非对方那一方的 fromId -> 条数
const byId = {};               // fromId -> 条数
let group = 0, single = 0, groupMsgs = 0, singleMsgs = 0, total = 0;
let oldest = null, newest = null;

for (const f of C.htmlFiles()) {
  const arr = new Function('return ' + extractArray(C.fs.readFileSync(C.path.join(C.DIR, f), 'utf8')))();
  if (!arr.length) continue;
  const isGroup = arr[0].sessionType === 'GROUP';
  isGroup ? group++ : single++;
  const sid = arr[0].sessionId;
  for (const m of arr) {
    total++;
    isGroup ? groupMsgs++ : singleMsgs++;
    const ty = String(m.type || '');
    if (ty.includes('TEXT')) types.TEXT++;
    else if (ty.includes('NOTE')) types.NOTE++;
    else if (ty.includes('IMAGE')) types.IMAGE++;
    else types.OTHER++;
    senders[m.fromName] = (senders[m.fromName] || 0) + 1;
    byId[m.fromId] = (byId[m.fromId] || 0) + 1;
    ids[m.fromId] = m.fromName;
    if (m.sessionType === 'SINGLE' && m.fromId !== sid) mineInSingle[m.fromId] = (mineInSingle[m.fromId] || 0) + 1;
    if (!oldest || m.datetime < oldest) oldest = m.datetime;
    if (!newest || m.datetime > newest) newest = m.datetime;
  }
}

const meEntry = Object.entries(mineInSingle).sort((a, b) => b[1] - a[1])[0];
const meName = meEntry ? ids[meEntry[0]] : '(未识别)';
const top = Object.entries(senders).sort((a, b) => b[1] - a[1]).slice(0, 5);

console.log('记录目录：' + C.DIR);
console.log(`会话        ${group + single} 个（群聊 ${group} + 私聊 ${single}）`);
console.log(`消息        ${total.toLocaleString()} 条（群聊 ${groupMsgs.toLocaleString()} / 私聊 ${singleMsgs.toLocaleString()}）`);
console.log(`类型        文字 ${types.TEXT.toLocaleString()} / 图片 ${types.IMAGE.toLocaleString()} / 笔记 ${types.NOTE.toLocaleString()} / 其他 ${types.OTHER}`);
console.log(`时间跨度    ${oldest} ~ ${newest}`);
console.log(`发言人      ${Object.keys(senders).length} 个不同昵称`);
console.log(`我          ${meName}${meEntry ? '（ID ' + meEntry[0] + '，共发 ' + senders[meName].toLocaleString() + ' 条）' : ''}`);
console.log(`最活跃      ${top.map(([n, c]) => n + ':' + c).join('  ')}`);
