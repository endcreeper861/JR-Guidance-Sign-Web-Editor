/**
 * render.js 纯几何函数测试（Node）
 * 使用确定性假测量器：width = ceil(len(text) × size × 0.9)
 */
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const load = (p) => (0, eval)(readFileSync(new URL(p, import.meta.url), 'utf8'));
load('../js/core.js');
load('../js/state.js');
load('../js/render.js');

const S = globalThis.SignState;
const R = globalThis.SignRender;
const Core = globalThis.SignCore;

const measure = (text, family, weight, size) => Math.ceil(String(text).length * size * 0.9);
// 假墨区度量：字肩/墨宽按比例（真实实现在浏览器里用 actualBoundingBox*）
measure.ascent = (text, family, weight, size) => Math.ceil(String(text).length * size * 0.8);
measure.ink = (text, family, weight, size) => ({
  abl: -0.05 * size,
  abr: 0.85 * size,
  adv: 0.9 * size,
});

test('contentBox 比例换算像素', () => {
  const box = R.contentBox({ top: 0.2, right: 0.1, bottom: 0.2, left: 0.1 }, 100);
  assert.equal(box.t, 20);
  assert.equal(box.r, 10);
  assert.equal(box.b, 20);
  assert.equal(box.l, 10);
  assert.equal(box.size, 60);
});

test('arrowGeometry left 方向坐标（sign_jr 移植）', () => {
  const s = 60, t = 15;
  const geo = R.arrowGeometry(s, t, 'left');
  const k = t / (2 * Math.SQRT2);
  assert.deepEqual(geo.head1, [[0, 30], [15, 30], [45, 0], [30, 0]]);
  assert.deepEqual(geo.head2, [[0, 30], [15, 30], [45, 60], [30, 60]]);
  // 箭柄为四点多边形
  assert.ok(Math.abs(geo.shaft[0][0] - t / 2) < 1e-9 && Math.abs(geo.shaft[0][1] - (30 - k)) < 1e-9);
  assert.ok(Math.abs(geo.shaft[1][0] - s) < 1e-9 && Math.abs(geo.shaft[1][1] - (30 - k)) < 1e-9);
  assert.ok(Math.abs(geo.shaft[2][0] - s) < 1e-9 && Math.abs(geo.shaft[2][1] - (30 + k)) < 1e-9);
  assert.ok(Math.abs(geo.shaft[3][0] - t / 2) < 1e-9 && Math.abs(geo.shaft[3][1] - (30 + k)) < 1e-9);
});

test('arrowGeometry up 方向坐标', () => {
  const s = 60, t = 15;
  const geo = R.arrowGeometry(s, t, 'up');
  const k = t / (2 * Math.SQRT2);
  assert.deepEqual(geo.head1, [[30, 0], [30, 15], [0, 45], [0, 30]]);
  assert.ok(Math.abs(geo.shaft[0][0] - (30 - k)) < 1e-9 && Math.abs(geo.shaft[0][1] - t / 2) < 1e-9);
  assert.ok(Math.abs(geo.shaft[2][1] - s) < 1e-9);
});

test('arrowGeometry 斜向：箭尖落在盒角、几何不越界', () => {
  const tips = {
    'left-up': [0, 0],
    'right-up': [60, 0],
    'right-down': [60, 60],
    'left-down': [0, 60],
  };
  Object.keys(tips).forEach((d) => {
    const geo = R.arrowGeometry(60, 15, d);
    const tip = geo.head1[0];
    assert.ok(Math.abs(tip[0] - tips[d][0]) < 1e-9 && Math.abs(tip[1] - tips[d][1]) < 1e-9,
      d + ' 箭尖应为盒角，实际 ' + tip);
    const all = geo.head1.concat(geo.head2, geo.shaft);
    const xs = all.map((p) => p[0]);
    const ys = all.map((p) => p[1]);
    assert.ok(Math.min(...xs) >= -1e-9 && Math.max(...xs) <= 60 + 1e-9, d + ' x 越界');
    assert.ok(Math.min(...ys) >= -1e-9 && Math.max(...ys) <= 60 + 1e-9, d + ' y 越界');
  });
});

test('八个方向元素宽度一致', () => {
  const dirs = ['left', 'up', 'right', 'down', 'left-up', 'right-up', 'right-down', 'left-down'];
  const widths = dirs.map((d) => R.computeElementWidth(S.createElement('arrow', { direction: d }), 100, measure));
  widths.forEach((w, i) => assert.ok(Math.abs(w - widths[0]) < 1e-9, '方向宽度不一致: ' + dirs[i]));
});

test('箭头宽度 = 内容尺寸 + 左右内边距', () => {
  const el = S.createElement('arrow');
  assert.equal(R.computeElementWidth(el, 100, measure), 100);
  const el2 = S.createElement('arrow', { padding: { left: 0.05, right: 0.05 } });
  assert.equal(R.computeElementWidth(el2, 100, measure), 70);
});

test('双语文本字号与宽度', () => {
  const el = S.createElement('bilingual-text', { textZh: '站名', textEn: 'Station' });
  const w = R.computeElementWidth(el, 100, measure);
  const bi = R.bilingualMetrics('站名', 'Station', 60, measure, false);
  assert.ok(Math.abs(bi.zhSize - 60 * 506 / 800) < 1e-9);
  assert.ok(Math.abs(bi.enSize - 60 * 285 / 800) < 1e-9);
  assert.equal(bi.zhW, 69);   // ceil(2 × 37.95 × 0.9)
  assert.equal(bi.enW, 135);  // ceil(7 × 21.375 × 0.9)
  assert.equal(w, 135 + 40);
  // 基线比例来自 sign_jr 的 PIL 定位公式
  assert.ok(Math.abs(bi.zhBase - 60 * (-1 / 6 + 1.16 * 506 / 800)) < 1e-9);
  assert.ok(Math.abs(bi.enBase - 60 * (2 / 3 + 0.9277 * 285 / 800)) < 1e-6);
});

test('大数字字号 1.3 倍、宽度含内边距', () => {
  const el = S.createElement('big-number', { text: '4' });
  const mt = R.elementMetrics(el, 100, measure);
  assert.equal(mt.fontSize, 78);            // 60 × 1.3
  assert.equal(mt.textW, 71);               // ceil(1 × 78 × 0.9)
  assert.equal(mt.width, 71 + 40);
  assert.ok(Math.abs(mt.base - (20 + 60 * 0.975)) < 1e-9);
});

test('大数字多位数：中段墨区紧排、盒边距与单位数一致', () => {
  const el = S.createElement('big-number', { text: '14' });
  const mt = R.elementMetrics(el, 100, measure);
  // 中段紧排：相邻数字间距与数字线路的墨区间距一致（「1」不再因字距显得松散）
  const nl = R.elementMetrics(
    S.createElement('number-line', { lines: [{ number: '14', color: '#000000' }] }),
    100, measure);
  assert.deepEqual(mt.digits.map(d => d.ch), ['1', '4']);
  assert.ok(Math.abs((mt.digits[1].x - mt.digits[0].x) -
                     (nl.entries[0].digits[1].x - nl.entries[0].digits[0].x)) < 1e-9);
  // 盒边距与单位数一致：首位墨区 = 首位字形自己的字距边距 lsb（不随位数变大）
  const ink1 = measure.ink('1', Core.FONT_NUM, 400, 78);
  const lsb1 = -ink1.abl;
  assert.ok(Math.abs((mt.digits[0].x - ink1.adv / 2 - ink1.abl) - lsb1) < 1e-9);
  // 宽度 = 两位的画布前进宽（首末字距边距保留，仅中段收紧）
  assert.ok(Math.abs(mt.textW - ink1.adv * 2) < 1e-9);
  assert.equal(mt.width, mt.textW + 40);
  assert.equal(mt.fontSize, 78);
  assert.ok(Math.abs(mt.base - (20 + 60 * 0.975)) < 1e-9); // 基线不变
  // 单位数行为不变
  const one = R.elementMetrics(S.createElement('big-number', { text: '1' }), 100, measure);
  assert.equal(one.textW, measure('1', Core.FONT_NUM, 400, 78));
  assert.ok(Math.abs(one.digits[0].x - one.textW / 2) < 1e-9);
});

test('数字线路：色条宽、出血高度、单/双位前进量、标签位置', () => {
  const el1 = S.createElement('number-line', { lines: [{ number: '1', color: '#E3002B' }] });
  const mt1 = R.elementMetrics(el1, 100, measure);
  assert.ok(Math.abs(mt1.entries[0].stripeW - 60 * 10 / 28) < 1e-9);
  assert.equal(mt1.stripeH, 80);            // 色条从内容顶出血到元素底
  assert.equal(mt1.entries[0].advance, 60); // 单位数字前进一个内容尺寸
  assert.equal(mt1.entries[0].digits[0].x, 30);
  assert.equal(mt1.entries[0].fontSize, 78);
  const labelW = Math.max(Math.ceil(2 * 45 * 0.6325 * 0.9), Math.ceil(4 * 45 * 0.35625 * 0.9));
  assert.equal(mt1.label.width, labelW);
  assert.ok(Math.abs(mt1.labelX - (20 + 60 * 10 / 28 + 60)) < 1e-9);

  const el2 = S.createElement('number-line', {
    lines: [{ number: '1', color: '#E3002B' }, { number: '12', color: '#461D84' }],
  });
  const mt2 = R.elementMetrics(el2, 100, measure);
  // 墨区排版：advance = M + Σ(墨宽+墨间距) − 末位间距
  const w12 = measure.ink('2', Core.FONT_NUM, 400, 78);
  const inkW = w12.abr + w12.abl;
  const m12 = (60 - w12.adv) / 2 - w12.abl;
  const g12 = -w12.abl + (w12.adv - w12.abr);
  assert.ok(Math.abs(mt2.entries[1].advance - (m12 + 2 * (inkW + g12) - g12 + m12)) < 1e-9);
});

test('数字线路：数字墨区顶与「号线」标签墨区顶对齐', () => {
  const el = S.createElement('number-line', { lines: [{ number: '3', color: '#E3002B' }] });
  const mt = R.elementMetrics(el, 100, measure);
  const labelTop = 20 + mt.label.zhBase - mt.label.zhAscent;
  assert.ok(Math.abs(mt.entries[0].base -
    (labelTop + measure.ascent('3', Core.FONT_NUM, 400, 78))) < 1e-9);
});

test('两位数字：墨区排版，首位墨区与单位数同位、「1」无特殊规则', () => {
  const el = S.createElement('number-line', { lines: [{ number: '14', color: '#461D84' }] });
  const mt = R.elementMetrics(el, 100, measure);
  const e = mt.entries[0];
  assert.equal(e.font, Core.FONT_NUM);      // 常规 Frutiger
  const ink = measure.ink('4', Core.FONT_NUM, 400, 78);
  const M = (60 - ink.adv) / 2 - ink.abl;   // 基准墨边距
  const g = -ink.abl + (ink.adv - ink.abr); // 墨区间距
  assert.equal(e.digits[0].ch, '1');
  assert.ok(Math.abs(e.digits[0].x - (M + ink.adv / 2 + ink.abl)) < 1e-9); // 首位墨左 = M
  assert.equal(e.digits[1].ch, '4');
  assert.ok(Math.abs(e.digits[1].x - (M + (ink.abr + ink.abl) + g + ink.adv / 2 + ink.abl)) < 1e-9);
  assert.ok(Math.abs(e.advance - (M + 2 * (ink.abr + ink.abl) + g + M)) < 1e-9);
  // 墨区顶与「号线」对齐
  const labelTop = 20 + mt.label.zhBase - mt.label.zhAscent;
  assert.ok(Math.abs(e.base - (labelTop + measure.ascent('14', Core.FONT_NUM, 400, 78))) < 1e-9);
});

test('bilingualAlignX：对齐基准为纯文本区宽度', () => {
  const label = { width: 200, zhW: 120, enW: 80 };
  const left = R.bilingualAlignX(label, 50, 'left', 2);
  assert.equal(left.zhX, 50);
  assert.equal(left.enX, 52);
  const right = R.bilingualAlignX(label, 50, 'right', 2);
  assert.equal(right.zhX, 50 + 200 - 120);        // 最宽文本右缘 = x + width
  assert.equal(right.enX, 50 + 200 - 80 - 2);
  const center = R.bilingualAlignX(label, 50, 'center', 2);
  assert.equal(center.zhX, 50 + 40);
  assert.equal(center.enX, 50 + 60);
});

test('双语文本 metrics：textW 为纯文本宽，width 含内边距', () => {
  const el = S.createElement('bilingual-text', { textZh: '站名', textEn: 'Station' });
  const mt = R.elementMetrics(el, 100, measure);
  assert.equal(mt.textW, Math.max(mt.zhW, mt.enW));
  assert.equal(mt.width, mt.textW + mt.pad.l + mt.pad.r);
});

test('文本线路：贯穿色条 + 大字占位 + 线/英文名标签', () => {
  const el = S.createElement('text-line', { text: '环', textEn: 'Loop Line' });
  const mt = R.elementMetrics(el, 100, measure);
  const s = 60;                                   // 内容尺寸 = 100 − 上下 padding
  assert.ok(Math.abs(mt.stripeW - s * 10 / 28) < 1e-9);  // 与数字线路同宽色条
  assert.equal(mt.stripeH, 80);                   // 色条从内容顶贯穿到行底
  assert.equal(mt.fontSize, s);                   // 与数字线路的数字同视觉高度
  assert.equal(mt.textW, measure('环', Core.FONT_ZH, 400, s));
  const labelW = Math.max(Math.ceil(1 * 45 * 0.6325 * 0.9), Math.ceil(9 * 45 * 0.35625 * 0.9));
  assert.equal(mt.label.width, labelW);           // 线 / Loop Line
  // 环与色条、环与「线」标签间距相等（各占一个 gap）
  assert.ok(Math.abs((mt.textCenterX - mt.textW / 2) - (20 + mt.stripeW) - s / 8) < 1e-9);
  assert.ok(Math.abs(mt.labelX - (mt.textCenterX + mt.textW / 2) - s / 8) < 1e-9);
  assert.equal(mt.width, 20 + mt.stripeW + s / 8 + mt.textW + s / 8 + labelW + 20);
});

test('文本线路：大字墨区顶与「线」标签墨区顶对齐', () => {
  const el = S.createElement('text-line', { text: '环', textEn: 'Loop Line' });
  const mt = R.elementMetrics(el, 100, measure);
  const labelTop = 20 + mt.label.zhBase - mt.label.zhAscent;
  assert.ok(Math.abs(mt.base -
    (labelTop + measure.ascent('环', Core.FONT_ZH, 400, 60))) < 1e-9);
});

test('文本线路：线路名下沉默认开启', () => {
  const el = S.createElement('text-line', { text: '环', textEn: 'Loop Line' });
  assert.equal(el.props.nameSink, true);
  assert.equal(R.elementMetrics(el, 100, measure).sink, true);
  // 缺省属性的历史数据按开启处理（向后兼容）
  const raw = {
    id: 'legacy', type: 'text-line',
    props: { padding: { top: 0.2, right: 0.2, bottom: 0.2, left: 0.2 } },
  };
  assert.equal(R.elementMetrics(raw, 100, measure).sink, true);
});

test('文本线路：关闭下沉 = 「线」同级字号完整显示（不加「线」后缀）', () => {
  const el = S.createElement('text-line', {
    text: '机场联络线', textEn: 'Airport Link Line', nameSink: false,
  });
  const mt = R.elementMetrics(el, 100, measure);
  const s = 60;
  // 字号与下沉模式尾部的「线 / 英文名」标签完全一致（盒高 0.75s 的双语标签）
  const sink = R.elementMetrics(
    S.createElement('text-line', { text: '环', textEn: 'Airport Link Line' }), 100, measure);
  assert.equal(mt.sink, false);
  assert.equal(mt.label.zhSize, sink.label.zhSize);
  assert.equal(mt.label.enSize, sink.label.enSize);
  assert.ok(Math.abs(mt.label.zhSize - s * 0.75 * R.ZH_FONT_RATIO) < 1e-9); // 非站名级字号
  assert.equal(mt.label.zhW, measure('机场联络线', Core.FONT_ZH, 400, mt.label.zhSize)); // 中文按输入全文测量
  assert.ok(mt.label.enBase > mt.label.zhBase);   // 英文基线在中文之下
  assert.equal(mt.label.enBase, s * 0.75 * R.EN_BASE_RATIO);
  // 色条贯穿与色条→文字间距不变
  assert.ok(Math.abs(mt.stripeW - s * 10 / 28) < 1e-9);
  assert.equal(mt.stripeH, 80);
  assert.equal(mt.gap, s / 8);
  assert.equal(mt.labelX, 20 + mt.stripeW + mt.gap);
  assert.equal(mt.width, 20 + mt.stripeW + s / 8 + mt.label.width + 20);
});

test('数字线路右对齐：色块移至标签右侧、仅渲染第 1 条线路', () => {
  const el = S.createElement('number-line', {
    lines: [{ number: '5', color: '#0094D8' }, { number: '9', color: '#E3002B' }],
    align: 'right',
  });
  const mt = R.elementMetrics(el, 100, measure);
  const s = 60;
  assert.equal(mt.labelAlign, 'right');
  assert.equal(mt.entries.length, 1);             // 右对齐仅渲染第 1 条线路
  assert.equal(mt.entries[0].digitsX, 20);        // 编号从内容左缘起排（不再有前置色条）
  assert.equal(mt.entries[0].advance, 60);
  const stripeW = s * 10 / 28;
  const labelW = Math.max(Math.ceil(2 * 45 * 0.6325 * 0.9), Math.ceil(4 * 45 * 0.35625 * 0.9));
  assert.equal(mt.labelX, 20 + 60);               // 标签紧跟编号（编号 advance 含尾随墨边距）
  // 「标签 → 色块」间距 = 左对齐时「色块 → 数字」的墨区边距 M（单位数字槽内居中边距）
  const inkAdv = 0.9 * 78, inkAbl = -0.05 * 78;   // 假墨区（fontSize = 78）
  const margin = (s - inkAdv) / 2 - inkAbl;
  assert.ok(Math.abs(mt.entries[0].stripeX - (mt.labelX + labelW + margin)) < 1e-9);
  assert.ok(Math.abs(mt.width - (mt.labelX + labelW + margin + stripeW + 20)) < 1e-9);
  // 数据未破坏：左对齐（默认）下两条线路完整渲染
  const left = R.elementMetrics(
    S.createElement('number-line', {
      lines: [{ number: '5', color: '#0094D8' }, { number: '9', color: '#E3002B' }],
    }), 100, measure);
  assert.equal(left.entries.length, 2);
  assert.ok(Math.abs(left.entries[0].stripeX - 20) < 1e-9);          // 左对齐：色条紧贴内容左缘
  assert.ok(Math.abs(left.entries[0].advance - 60) < 1e-9);
  assert.ok(Math.abs(left.width - (20 + 2 * (stripeW + 60) + labelW + 20)) < 1e-9);
});

test('数字线路右对齐：多位数的标签间距用基准墨边距 M', () => {
  const el = S.createElement('number-line', {
    lines: [{ number: '14', color: '#461D84' }],
    align: 'right',
  });
  const mt = R.elementMetrics(el, 100, measure);
  const ink3 = measure.ink('3', Core.FONT_NUM, 400, 78);
  const M = (60 - ink3.adv) / 2 - ink3.abl;       // 基准墨边距（首位墨区锚定，与左对齐一致）
  const labelW = Math.max(Math.ceil(2 * 45 * 0.6325 * 0.9), Math.ceil(4 * 45 * 0.35625 * 0.9));
  assert.ok(Math.abs(mt.entries[0].stripeX - (mt.labelX + labelW + M)) < 1e-9);
});

test('数字线路左对齐：entries 携带绝对坐标（色条在编号前）', () => {
  const el = S.createElement('number-line', {
    lines: [{ number: '1', color: '#E3002B' }, { number: '12', color: '#461D84' }],
  });
  const mt = R.elementMetrics(el, 100, measure);
  const stripeW = 60 * 10 / 28;
  assert.equal(mt.entries[0].stripeX, 20);
  assert.equal(mt.entries[0].digitsX, 20 + stripeW);
  assert.ok(Math.abs(mt.entries[1].stripeX - (20 + stripeW + 60)) < 1e-9);
  assert.ok(Math.abs(mt.entries[1].digitsX - (20 + 2 * stripeW + 60)) < 1e-9);
  assert.equal(mt.labelAlign, 'left');
});

test('文字线路右对齐：色块移至右缘、标签盒内右对齐（宽为左对齐镜像）', () => {
  const el = S.createElement('text-line', { text: '环', textEn: 'Loop Line', align: 'right' });
  const mt = R.elementMetrics(el, 100, measure);
  const s = 60;
  const stripeW = s * 10 / 28;
  const textW = measure('环', Core.FONT_ZH, 400, s);
  assert.equal(mt.labelAlign, 'right');
  assert.equal(mt.textCenterX, 20 + textW / 2);   // 大字移到内容左缘
  assert.equal(mt.labelX, 20 + textW + s / 8);
  assert.ok(Math.abs(mt.stripeX - (mt.labelX + mt.label.width + s / 8)) < 1e-9);
  assert.ok(Math.abs(mt.stripeX + stripeW + 20 - mt.width) < 1e-9);
  // 镜像对称：与左对齐总宽一致
  const left = R.elementMetrics(S.createElement('text-line', { text: '环', textEn: 'Loop Line' }), 100, measure);
  assert.ok(Math.abs(mt.width - left.width) < 1e-9);
});

test('文字线路平铺右对齐：完整线路名在左、色块在右', () => {
  const el = S.createElement('text-line', {
    text: '机场联络线', textEn: 'Airport Link Line', nameSink: false, align: 'right',
  });
  const mt = R.elementMetrics(el, 100, measure);
  assert.equal(mt.sink, false);
  assert.equal(mt.labelAlign, 'right');
  assert.equal(mt.labelX, 20);                    // 完整线路名贴内容左缘
  assert.ok(Math.abs(mt.stripeX - (20 + mt.label.width + mt.gap)) < 1e-9);
  assert.ok(Math.abs(mt.width - (mt.stripeX + mt.stripeW + 20)) < 1e-9);
});

test('出口右对齐：编号移至「出口」右侧、基线不变、宽为镜像；出入口不受 align 影响', () => {
  const exitR = S.createElement('exit', { code: '1', align: 'right' });
  const exitL = S.createElement('exit', { code: '1' });
  const mtR = R.elementMetrics(exitR, 100, measure);
  const mtL = R.elementMetrics(exitL, 100, measure);
  assert.equal(mtR.labelAlign, 'right');
  assert.equal(mtR.labelX, 20);                   // 标签移到内容左缘
  assert.ok(Math.abs(mtR.codeCenterX - (20 + mtR.label.width + mtR.gap + mtR.codeW / 2)) < 1e-9);
  assert.equal(mtR.codeBase, mtL.codeBase);       // 编号基线不变
  assert.ok(Math.abs(mtR.width - mtL.width) < 1e-9); // 镜像对称
  // 出入口（entrance）不支持内容对齐：align=right 不生效
  const enR = R.elementMetrics(S.createElement('entrance', { code: 'C', align: 'right' }), 100, measure);
  const enL = R.elementMetrics(S.createElement('entrance', { code: 'C' }), 100, measure);
  assert.equal(enR.labelAlign, 'left');
  assert.equal(enR.codeCenterX, enL.codeCenterX);
  assert.equal(enR.width, enL.width);
});

test('出入口/出口：编号宽度 + 1/8 间隙 + 标签', () => {
  const el = S.createElement('entrance', { code: 'C' });
  const mt = R.elementMetrics(el, 100, measure);
  assert.equal(mt.codeW, 71);
  assert.equal(mt.gap, 7.5);
  assert.equal(mt.width, 20 + 71 + 7.5 + mt.label.width + 20);
});

test('空白占位宽度 = 行高 × 比例', () => {
  const el = S.createElement('space', { widthRatio: 0.6 });
  assert.equal(R.computeElementWidth(el, 100, measure), 60);
});

test('图标：正方形宽度 = 内容尺寸 + 左右内边距', () => {
  const el = S.createElement('icon', {
    padding: { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 },
  });
  assert.equal(R.computeElementWidth(el, 100, measure), 100);
});

test('computeRowWidth 求和', () => {
  const row = {
    id: 'r',
    elements: [
      S.createElement('space', { widthRatio: 0.5 }),
      S.createElement('space', { widthRatio: 0.25 }),
    ],
  };
  assert.equal(R.computeRowWidth(row, 100, measure), 75);
});

test('动态宽度 = 最宽行（空牌至少一个行高）', () => {
  const sign = S.createSign();
  sign.widthMode = 'dynamic';
  assert.equal(R.computeSignWidth(sign, measure), 256); // 一行空行
  let s2 = S.addElement(sign, sign.rows[0].id,
    S.createElement('space', { widthRatio: 1.5 }));
  assert.equal(R.computeSignWidth(s2, measure), 384);
});

test('layoutSign 行 y 与元素 x 累计', () => {
  let sign = S.createSign();
  sign.rowHeight = 100;
  sign = S.addRow(sign);
  const a = S.createElement('space', { widthRatio: 0.5 });
  const b = S.createElement('space', { widthRatio: 0.25 });
  sign = S.addElement(sign, sign.rows[0].id, a);
  sign = S.addElement(sign, sign.rows[0].id, b);
  const layout = R.layoutSign(sign, measure);
  assert.equal(layout.height, 200);
  assert.equal(layout.rows[0].y, 0);
  assert.equal(layout.rows[1].y, 100);
  assert.equal(layout.rows[0].elements[0].x, 0);
  assert.equal(layout.rows[0].elements[1].x, 50);
  assert.equal(layout.rows[0].elements[1].width, 25);
  assert.equal(layout.rows[0].contentWidth, 75);
});

test('固定宽度：元素三车道对齐（左流式/居中成组/右贴边）', () => {
  let sign = S.createSign();
  sign.width = 1000;
  sign.rowHeight = 100;
  const a = S.createElement('space', { widthRatio: 0.2, elementAlign: 'left' });   // 20
  const b = S.createElement('space', { widthRatio: 0.3, elementAlign: 'center' }); // 30
  const c = S.createElement('space', { widthRatio: 0.1, elementAlign: 'right' });  // 10
  sign = S.addElement(sign, sign.rows[0].id, a);
  sign = S.addElement(sign, sign.rows[0].id, b);
  sign = S.addElement(sign, sign.rows[0].id, c);
  const slots = R.layoutSign(sign, measure).rows[0].elements;
  assert.equal(slots[0].x, 0);                       // 贴左从左缘排
  assert.ok(Math.abs(slots[1].x - (1000 - 30) / 2) < 1e-9); // 居中成组
  assert.ok(Math.abs(slots[2].x - (1000 - 10)) < 1e-9);     // 贴右从右缘排
});

test('动态宽度忽略元素对齐，整体左起排列', () => {
  let sign = S.createSign();
  sign.widthMode = 'dynamic';
  sign.rowHeight = 100;
  const a = S.createElement('space', { widthRatio: 0.2, elementAlign: 'right' });
  const b = S.createElement('space', { widthRatio: 0.3 });
  sign = S.addElement(sign, sign.rows[0].id, a);
  sign = S.addElement(sign, sign.rows[0].id, b);
  const slots = R.layoutSign(sign, measure).rows[0].elements;
  assert.equal(slots[0].x, 0);
  assert.equal(slots[1].x, 20);
});
