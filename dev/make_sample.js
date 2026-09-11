/**
 * 生成虚构的样例数据（sample_data/），用于让这个项目开箱可跑、测试不依赖任何真实记录。
 * 刻意埋了几个坑，作为解析器的回归样本：
 *   - 正文里包含 `];`            → 用 indexOf 找数组结尾会被截断（本项目踩过的坑）
 *   - 正文里包含 {'type': "X"}   → 单引号/花括号干扰朴素切分
 *   - 正文包含换行、emoji、网址
 *   CHAT_DIR 之类的路径全部虚构。
 *   node make_sample.js
 */
const fs = require('fs'), path = require('path');
const OUTDIR = path.join(__dirname, '..', 'sample_data');
const ME = 9001, ME_NAME = '林小舟';

const S = {
  group: { id: 3001, name: '高二(3)班通知群', type: 'GROUP' },
  club:  { id: 3002, name: '机器人社·技术组', type: 'GROUP' },
  peer:  { id: 4001, name: '陈屿', type: 'SINGLE' }
};

// [天数偏移, 时:分, fromId, 昵称, 类型, 内容]
const rows = [
  [0, '08:12', 4001, '陈屿', 'TEXT', '早，今天物理作业是第几页？'],
  [0, '08:15', ME, ME_NAME, 'TEXT', '我看看…P87 到 P89，第 6 题不用做'],
  [0, '08:16', 4001, '陈屿', 'TEXT', '收到，谢了'],
  [0, '12:40', ME, ME_NAME, 'TEXT', '对了，明天的社活我带了烙铁和万用表'],
  [0, '12:41', 4001, '陈屿', 'TEXT', '好，我把上次没焊完的板子带过来'],
  [2, '19:05', 4001, '陈屿', 'TEXT', '板子焊好了，就是有点烫手 🔥'],
  [2, '19:30', ME, ME_NAME, 'TEXT', '散热片记得加，不然跑十分钟就降频'],
  [2, '19:31', 4001, '陈屿', 'TEXT', '行，明天带过去给你看'],
  [5, '21:02', 4001, '陈屿', 'TEXT', '睡了吗？帮我看下这段代码为啥报错\nvar array = [1, 2];\nconsole.log(array)'],
  [5, '21:20', ME, ME_NAME, 'TEXT', '少了个分号？看着不像。你把完整报错发我'],
  [5, '21:22', 4001, '陈屿', 'TEXT', 'TypeError: Cannot read properties of undefined'],
  [5, '21:25', ME, ME_NAME, 'TEXT', '那就是 array 本身没定义，是不是 return 写在了回调外面']
];

const groupRows = [
  [0, '07:55', 5002, '班主任', 'TEXT', '各位同学，本周五下午第三节调整为班会，请提前安排好值日。'],
  [0, '07:58', 5003, '班长·周乐', 'TEXT', '收到'],
  [0, '08:01', 5004, '学委·许一鸣', 'TEXT', '收到'],
  [0, '08:02', ME, ME_NAME, 'TEXT', '收到'],
  [1, '16:20', 5005, '体育委员·赵野', 'TEXT', '运动会报名表在群里了，想报项目的接龙，格式：\n1. 姓名-项目\n2. ……'],
  [1, '16:22', 5006, '钱多多', 'TEXT', '1. 钱多多-跳远'],
  [1, '16:23', 5004, '学委·许一鸣', 'TEXT', '2. 许一鸣-1500米'],
  [1, '16:25', ME, ME_NAME, 'TEXT', '3. 林小舟-4×100接力'],
  [1, '16:30', 5005, '体育委员·赵野', 'TEXT', '好，目前够了，还差两个女生项目'],
  [3, '09:10', 5003, '班长·周乐', 'TEXT', '温馨提示：这周的化学实验要穿长裤，别穿凉鞋 🧪'],
  [3, '09:12', 5002, '班主任', 'TEXT', '另外，教室里那把坏椅子我已经报修了，先别坐'],
  [3, '10:44', 5004, '学委·许一鸣', 'TEXT', '数学卷子答案我发到平板上了，注意第 12 题第二问的数量级是 3.2×10⁴，之前那版印错了'],
  [6, '15:00', 5006, '钱多多', 'TEXT', '谁把充电宝落在实验室了？在我这儿，蓝色的那个'],
  [6, '15:02', ME, ME_NAME, 'TEXT', '我的，谢谢，明天找你拿'],
  [6, '15:03', 5006, '钱多多', 'TEXT', 'OK'],
  [9, '20:30', 5005, '体育委员·赵野', 'TEXT', '明天下午有场地，想练接力的留一下，四点半到操场南门'],
  [9, '20:31', ME, ME_NAME, 'TEXT', '我留'],
  [9, '20:33', 5003, '班长·周乐', 'TEXT', '我也留，正好把棒次定一下']
];

const clubRows = [
  [0, '18:00', 6001, '社长·方澈', 'TEXT', '这周的技术分享谁来讲？主题定一下，最好有点干货'],
  [0, '18:05', 6002, '副社·佘丹', 'TEXT', '我可以讲一下 PID 调参，正好上次比赛的数据还在'],
  [0, '18:06', ME, ME_NAME, 'TEXT', '那我讲怎么把串口日志接到电脑上看波形，实操向的'],
  [0, '18:07', 6001, '社长·方澈', 'TEXT', '好，那就两个连着讲，一人半小时'],
  [2, '19:40', 6003, '新成员·柯一', 'TEXT', '请问电机驱动板是 P 几的接口？我照着 wiki 接的不转'],
  [2, '19:45', ME, ME_NAME, 'TEXT', '先确认供电：驱动板的 VM 要单独接电池，别从主板取电'],
  [2, '19:47', 6003, '新成员·柯一', 'TEXT', '啊，我确实从主板取的电…'],
  [2, '19:48', 6001, '社长·方澈', 'TEXT', '这个坑人人都踩一次 😂'],
  [7, '20:10', 6002, '副社·佘丹', 'TEXT', '仓库地址换到 https://example.invalid/team/robotics 了，旧的别再用'],
  [7, '20:12', ME, ME_NAME, 'TEXT', '收到，我把本地 remote 也改一下'],
  [11, '21:00', 6001, '社长·方澈', 'TEXT', '下周比赛报名截止周三，还没定的今晚定下来']
];

function esc(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

function build(sess, list) {
  const arr = list.map((r, i) => {
    const [d, hm, fromId, fromName, type, content] = r;
    const day = new Date(Date.UTC(2025, 2, 3 + d));           // 2025-03-03 起
    const date = day.toISOString().slice(0, 10);
    const ts = Date.parse(date + 'T' + hm + ':00Z') + 8 * 3600 * 1000;   // 当作东八区
    const isText = type === 'TEXT';
    const t = (sess.type === 'GROUP' ? 'GROUP_' : 'SINGLE_') + type;
    return `{'fromId': ${fromId}, 'sessionId': ${sess.id}, 'toId': 0, 'sessionType': '${sess.type}', ` +
      `'token': 'sample-${sess.id}-${i}', 'msgId': ${list.length - i}, 'type': '${t}', ` +
      `'content': '${esc(content)}', 'createdTime': ${ts}, 'status': 'OK', 'extend': '', 'sendTime': 0, ` +
      `'fromName': '${esc(fromName)}', 'datetime': '${date} ${hm}:00'}`;
  });
  // 故意把数组写成倒序（真实导出就是这样），并带上真实的渲染尾巴
  const body = '[' + arr.reverse().join(',\n') + ']';
  return `<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head><body><div id="msgs"></div></body><script type="text/javascript">var array = ${body};var html = '';for (var i = 0; i < array.length; i++) {    msg = array[i];    if (msg.type == 'SINGLE_TEXT' || msg.type == 'GROUP_TEXT') {        html += '<p>' + msg.fromName + ': ' + msg.content + '</p>';    }}document.getElementById('msgs').innerHTML = html;</script></html>`;
}

fs.mkdirSync(OUTDIR, { recursive: true });
const jobs = [['高二(3)班通知群', S.group, groupRows], ['机器人社·技术组', S.club, clubRows], ['陈屿', S.peer, rows]];
let total = 0;
for (const [name, sess, list] of jobs) {
  fs.writeFileSync(path.join(OUTDIR, name + '.html'), build(sess, list), 'utf8');
  total += list.length;
  console.log(`${name}.html  ${list.length} 条`);
}
console.log(`\n已生成到 ${OUTDIR}：${jobs.length} 个会话 / ${total} 条虚构消息（我 = ${ME_NAME}）`);
