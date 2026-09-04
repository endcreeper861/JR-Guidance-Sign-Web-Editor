/**
 * gen-icons.mjs — 从外部 SVG 目录生成 web-app/js/icons.js
 * 用法：node gen-icons.mjs <图标源目录>（含服务设施 *.svg 与 arrows/*.svg）
 * 处理：剥离 defs/clip-path（均为整幅矩形裁剪，视觉无操作）、fill 归一
 * （无 fill 的绘制元素补 fill="black"，#000 变体归一），渲染时 "black" 替换为元素颜色。
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const srcDir = process.argv[2];
if (!srcDir) { console.error('用法: node gen-icons.mjs <图标源目录>'); process.exit(1); }

const NAMES = {
  // 服务设施
  elevator: '电梯', restroom: '洗手间', accessible_restroom: '无障碍洗手间',
  stairs: '楼梯', tickets: '票务', waiting: '候车室', nursing: '母婴室',
  check_in: '检票', no_entry: '禁止通行', accessible: '无障碍',
  accessible_elevator_platform: '无障碍电梯平台', accessible_passage: '无障碍通道',
  accessible_ramp: '无障碍坡道', metro: '地铁', monorail: '单轨',
  train: '列车', exit: '出口',
  // 方向箭头（12）
  arrow_up: '向上', arrow_down: '向下', arrow_left: '向左', arrow_right: '向右',
  arrow_left_up: '左上', arrow_right_up: '右上', arrow_right_down: '右下', arrow_left_down: '左下',
  arrow_ahead_left: '前方向左', arrow_ahead_right: '前方向右',
  arrow_back_left: '左行向后', arrow_back_right: '右行向后',
};
// arrows/ 文件名 → 语义 id（downleft=前方向左，upleft=左行向后）
const ARROW_IDS = {
  up: 'arrow_up', down: 'arrow_down', left: 'arrow_left', right: 'arrow_right',
  leftup: 'arrow_left_up', upright: 'arrow_right_up', rightdown: 'arrow_right_down',
  leftdown: 'arrow_left_down', downleft: 'arrow_ahead_left', downright: 'arrow_ahead_right',
  upleft: 'arrow_back_left', rightup: 'arrow_back_right',
};

function processSvg(file) {
  let svg = readFileSync(file, 'utf8');
  const vb = (svg.match(/viewBox="([^"]+)"/) || [])[1];
  if (!vb) throw new Error('缺少 viewBox: ' + file);
  let body = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  body = body.replace(/<defs>[\s\S]*?<\/defs>/g, '');
  body = body.replace(/\s*clip-path="[^"]*"/g, '');
  body = body.replace(/<(path|rect|circle|ellipse|polygon|line)((?:(?!fill=)[^>])*?)(\/?)>/g,
    (m0, tag, attrs, slash) => `<${tag} fill="black"${attrs}${slash}>`);
  body = body.replace(/fill="#000000"/gi, 'fill="black"').replace(/fill="#000"/gi, 'fill="black"');
  if (/url\(#/.test(body)) throw new Error('存在未处理的内部引用: ' + file);
  return { vb, body };
}

const icons = {};
for (const f of readdirSync(srcDir)) {
  const full = join(srcDir, f);
  if (!statSync(full).isFile() || !f.toLowerCase().endsWith('.svg')) continue;
  const id = f.replace(/\.svg$/i, '');
  if (['arrow', 'default', 'ellipse', 'placeholder'].includes(id)) continue; // 占位/重复项跳过
  const name = NAMES[id];
  if (!name) throw new Error('缺少中文名映射: ' + id);
  const { vb, body } = processSvg(full);
  icons[id] = { name, cat: 'service', vb, body };
}
const arrowsDir = join(srcDir, 'arrows');
for (const f of readdirSync(arrowsDir)) {
  if (!f.toLowerCase().endsWith('.svg')) continue;
  const base = f.replace(/\.svg$/i, '');
  if (base === 'metro') continue; // 与根目录 metro.svg 重复
  const id = ARROW_IDS[base];
  if (!id) throw new Error('arrows 下存在未映射文件: ' + f);
  const { vb, body } = processSvg(join(arrowsDir, f));
  icons[id] = { name: NAMES[id], cat: 'arrows', vb, body };
}

const header = `/**
 * icons.js — 图标库数据（由 gen-icons.mjs 从 signmaker-main/icon 生成，勿手工编辑）
 * body 为 <svg> 内部标记；渲染时 fill="black" 替换为元素颜色。
 */
`;
const out = header +
  '(function (global) {\n  \'use strict\';\n  var ICONS = {\n' +
  Object.entries(icons).map(([id, ic]) =>
    '    ' + JSON.stringify(id) + ': { name: ' + JSON.stringify(ic.name) +
    ', cat: ' + JSON.stringify(ic.cat) + ', vb: ' + JSON.stringify(ic.vb) +
    ', body: ' + JSON.stringify(ic.body) + ' }').join(',\n') +
  '\n  };\n' +
  '  global.SignIcons = {\n    ALL: ICONS,\n' +
  '    CATS: [{ id: "arrows", name: "方向图标" }, { id: "service", name: "服务设施" }],\n' +
  '    get: function (id) { return ICONS[id] || ICONS.elevator; },\n  };\n' +
  '})(typeof window !== "undefined" ? window : globalThis);\n';

writeFileSync(new URL('./js/icons.js', import.meta.url), out);
console.log('已生成 js/icons.js，共 ' + Object.keys(icons).length + ' 个图标：' +
  Object.keys(icons).join(', '));
