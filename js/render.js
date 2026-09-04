/**
 * render.js — SVG 渲染引擎（ADR-0001）
 *
 * 每个元素类型 = 一个 metrics 函数（纯几何，Node 可测）+ 一个绘制函数。
 * metrics 输入 (element, rowHeight, measure)，输出宽度与全部绘制坐标；
 * 绘制函数消费 metrics 生成 SVG DOM 片段。二者共用同一套公式，保证布局所见即所得。
 *
 * 关键比例均移植自 sign_jr.py（PRD 指定参考实现）：
 *   双语文本字号  size × 506/800（中）/ × 285/800（英）
 *   大数字/编号   size × 1.3，Frutiger
 *   线路色条宽    size × 10/28
 *   箭头          双 45° 梯形箭头头 + 矩形箭柄（柄厚 = thickness/√2）
 */
(function (global) {
  'use strict';

  var Core = global.SignCore;
  var HAS_DOM = typeof document !== 'undefined' && document.createElementNS;

  // ─── 布局常量（相对内容尺寸 s 的比例）──────────────────────

  var ZH_FONT_RATIO = 506 / 800;   // 0.6325  中文字号
  var EN_FONT_RATIO = 285 / 800;   // 0.35625 英文字号
  var ZH_BASE_RATIO = -1 / 6 + Core.FONT_METRICS.zhAsc * ZH_FONT_RATIO; // 0.5670 中文基线
  var EN_BASE_RATIO = 2 / 3 + Core.FONT_METRICS.enAsc * EN_FONT_RATIO;  // 0.9972 英文基线
  var NUM_FONT_RATIO = 1.3;        // 大数字/编号字号
  var NUM_BASE_RATIO = Core.FONT_METRICS.numAsc * NUM_FONT_RATIO;       // 0.975 数字基线
  var STRIPE_RATIO = 10 / 28;      // 线路色条宽
  var LABEL_BOX_RATIO = 0.75;      // 组合元素尾部双语标签的内容盒高
  var EN_ALIGN_OFFSET = 1 / 30;    // 英文左右对齐时的额外缩进

  // ─── 通用盒模型 ────────────────────────────────────────────

  /** 比例 padding → 像素，并给出内容盒 */
  function contentBox(padding, rowHeight) {
    var t = padding.top * rowHeight;
    var r = padding.right * rowHeight;
    var b = padding.bottom * rowHeight;
    var l = padding.left * rowHeight;
    return { t: t, r: r, b: b, l: l, top: t, size: rowHeight - t - b };
  }

  // ─── 箭头几何（sign_jr.Arrow 坐标移植 + 斜向旋转）─────────

  /**
   * 轴向箭头（left/right/up/down）三块形状，箭盒为 size²：
   *   head: 两个四边形（polygon 点数组），shaft: 四点多边形
   * 箭头头为两条 45° 平行四边形笔画（视觉笔画宽 = thickness/√2），箭柄等厚衔接。
   */
  function axisArrowGeometry(size, thickness, direction) {
    var c = size / 2;
    var k = thickness / (2 * Math.SQRT2); // 箭柄半厚 = thickness/√2 / 2
    var head1, head2, shaft;
    if (direction === 'left') {
      head1 = [[0, c], [thickness, c], [thickness + c, 0], [c, 0]];
      head2 = [[0, c], [thickness, c], [thickness + c, size], [c, size]];
      shaft = [
        [thickness / 2, c - k], [size, c - k], [size, c + k], [thickness / 2, c + k],
      ];
    } else if (direction === 'right') {
      head1 = [[size, c], [size - thickness, c], [size - thickness - c, 0], [size - c, 0]];
      head2 = [[size, c], [size - thickness, c], [size - thickness - c, size], [size - c, size]];
      shaft = [
        [0, c - k], [size - thickness / 2, c - k], [size - thickness / 2, c + k], [0, c + k],
      ];
    } else if (direction === 'up') {
      head1 = [[c, 0], [c, thickness], [0, thickness + c], [0, c]];
      head2 = [[c, 0], [c, thickness], [size, thickness + c], [size, c]];
      shaft = [
        [c - k, thickness / 2], [c + k, thickness / 2], [c + k, size], [c - k, size],
      ];
    } else { // down
      head1 = [[c, size], [c, size - thickness], [0, size - thickness - c], [0, size - c]];
      head2 = [[c, size], [c, size - thickness], [size, size - thickness - c], [size, size - c]];
      shaft = [
        [c - k, 0], [c + k, 0], [c + k, size - thickness / 2], [c - k, size - thickness / 2],
      ];
    }
    return { head1: head1, head2: head2, shaft: shaft };
  }

  // 斜向 = 轴对齐基底（左/右）在虚拟盒（长 √2s − t）内构建后旋转 ±45°，
  // 箭尖精确锚在内容盒角上；头部远角恰好触及盒缘，几何不越界。
  var DIAGONAL_ARROW = {
    'left-up': { base: 'left', phi: 45, corner: [0, 0] },
    'right-up': { base: 'right', phi: -45, corner: [1, 0] },
    'right-down': { base: 'right', phi: 45, corner: [1, 1] },
    'left-down': { base: 'left', phi: -45, corner: [0, 1] },
  };

  function arrowGeometry(size, thickness, direction) {
    var diag = DIAGONAL_ARROW[direction];
    if (!diag) return axisArrowGeometry(size, thickness, direction);
    var L = size * Math.SQRT2 - thickness;
    var g = axisArrowGeometry(L, thickness, diag.base);
    var phi = diag.phi * Math.PI / 180;
    var cos = Math.cos(phi), sin = Math.sin(phi);
    var cl = L / 2;
    var tip = diag.base === 'left' ? [0, cl] : [L, cl];
    function rel(p) {
      var dx = p[0] - cl, dy = p[1] - cl;
      return [dx * cos - dy * sin, dx * sin + dy * cos];
    }
    var tipRot = rel(tip);
    var ox = diag.corner[0] * size - tipRot[0];
    var oy = diag.corner[1] * size - tipRot[1];
    function rot(p) {
      var q = rel(p);
      return [q[0] + ox, q[1] + oy];
    }
    return {
      head1: g.head1.map(rot),
      head2: g.head2.map(rot),
      shaft: g.shaft.map(rot),
    };
  }

  // ─── 双语标签（组合元素内部复用：号线/出入口/出口/线）─────

  /**
   * 双语文本测量。boxSize 为本标签自身的内容尺寸（非行高）。
   * 返回 { width, zhSize, enSize, zhBase, enBase }
   */
  function bilingualMetrics(textZh, textEn, boxSize, measure, bold) {
    var weight = bold ? 700 : 400;
    var zhSize = boxSize * ZH_FONT_RATIO;
    var enSize = boxSize * EN_FONT_RATIO;
    var zhW = measure(textZh, Core.FONT_ZH, weight, zhSize);
    var enW = measure(textEn, Core.FONT_EN, weight, enSize);
    return {
      width: Math.max(zhW, enW),
      zhSize: zhSize,
      enSize: enSize,
      zhW: zhW,
      enW: enW,
      zhBase: boxSize * ZH_BASE_RATIO,
      enBase: boxSize * EN_BASE_RATIO,
      weight: weight,
      zhAscent: measure.ascent(textZh, Core.FONT_ZH, weight, zhSize), // 墨区上升高，用于顶对齐
    };
  }

  // ─── 各元素 metrics（纯函数：宽度 + 绘制坐标）──────────────

  function arrowMetrics(el, h, m) {
    var p = contentBox(el.props.padding, h);
    var s = p.size;
    var th = Core.clamp(el.props.thicknessRatio, 0.05, 0.95) * s;
    var geo = arrowGeometry(s, th, el.props.direction);
    return { pad: p, size: s, geo: geo, width: s + p.l + p.r, offset: { x: p.l, y: p.t } };
  }

  function bilingualTextMetrics(el, h, m) {
    var p = contentBox(el.props.padding, h);
    var bi = bilingualMetrics(el.props.textZh, el.props.textEn, p.size, m, el.props.bold);
    bi.pad = p;
    bi.textW = bi.width;
    bi.width = bi.width + p.l + p.r;
    return bi;
  }

  function bigNumberMetrics(el, h, m) {
    var p = contentBox(el.props.padding, h);
    var size = p.size * NUM_FONT_RATIO;
    var w = m(el.props.text, Core.FONT_NUM, 400, size);
    return {
      pad: p, fontSize: size, textW: w,
      base: p.t + p.size * NUM_BASE_RATIO,
      width: w + p.l + p.r,
    };
  }

  /**
   * 数字组墨区布局：所有间距按字形墨区（而非等宽字距）计算，视觉节奏一致。
   * - 首位墨区左缘锚定在基准墨边距 M（参考数字「3」在单位数槽位中的自然墨边距，
   *   即 (s − adv₃)/2 + lsb₃），任意线路号与色条的视觉间距一致 ——「1」墨区窄，
   *   不再因字距居中而显得离色条更远；
   * - 相邻数字的墨区间距固定为 g = lsb₃ + rsb₃（「1」不再需要特殊削减规则）；
   * - 槽位 advance = 末位墨区右缘 + M，右侧留白与左侧对称。
   * 单位数字仍居中于 0.5s（光学居中）。返回 { digits:[{ch,x}], advance }，
   * x 相对色条右缘，配合 text-anchor=middle。
   */
  function digitLayout(num, s, fontSize, m) {
    var chars = num.split('');
    if (chars.length < 2) {
      if (chars.length === 0) return { digits: [], advance: s, margin: 0 };
      var ink = m.ink(chars[0], Core.FONT_NUM, 400, fontSize);
      return {
        digits: [{ ch: chars[0], x: s * 0.5 }],
        advance: s,
        // 单位数字槽内居中的墨边距 = 左对齐时色块与数字的视觉间距
        margin: (s - ink.adv) / 2 - ink.abl,
      };
    }
    var ref = m.ink('3', Core.FONT_NUM, 400, fontSize);
    var margin = (s - ref.adv) / 2 - ref.abl;   // (s−adv₃)/2 + lsb₃
    var gap = (-ref.abl) + (ref.adv - ref.abr); // lsb₃ + rsb₃
    var inkLeft = margin;
    var digits = chars.map(function (ch) {
      var ink = m.ink(ch, Core.FONT_NUM, 400, fontSize);
      var x = inkLeft + ink.adv / 2 + ink.abl;  // 墨左缘 → anchor=middle 绘制点
      inkLeft += (ink.abr + ink.abl) + gap;     // 墨宽 + 固定墨区间距
      return { ch: ch, x: x };
    });
    return { digits: digits, advance: inkLeft - gap + margin, margin: margin };
  }

  function numberLineMetrics(el, h, m) {
    var p = contentBox(el.props.padding, h);
    var s = p.size;
    var stripeW = s * STRIPE_RATIO;
    var label = bilingualMetrics('号线', 'Line', s * LABEL_BOX_RATIO, m, false);
    var labelTop = p.t + label.zhBase - label.zhAscent; // 「号线」墨区顶
    var right = el.props.align === 'right';
    // 右对齐仅渲染第 1 条线路（现实导视中右置牌均为单线路）；数据保留，切回左对齐恢复
    var lines = right ? (el.props.lines || []).slice(0, 1) : (el.props.lines || []);
    var layouts = lines.map(function (line) {
      var num = String(line.number || '');
      var layout = digitLayout(num, s, s * NUM_FONT_RATIO, m);
      return {
        num: num, color: line.color, digits: layout.digits, advance: layout.advance,
        margin: layout.margin,
        base: labelTop + m.ascent(num, Core.FONT_NUM, 400, s * NUM_FONT_RATIO),
      };
    });
    var stripesW = layouts.length * stripeW;
    var labelAlign = right ? 'right' : 'left';
    // 首条线路的墨区边距：左对齐时是「色块 → 数字」的视觉间距，
    // 右对齐时同值用于「标签 → 色块」，保证两种模式的间距一致
    var firstMargin = layouts.length ? layouts[0].margin : 0;
    var labelX, stripesX0;
    if (right) {
      labelX = p.l + layouts.reduce(function (acc, L) { return acc + L.advance; }, 0);
      stripesX0 = labelX + label.width + firstMargin;   // 色块组移至标签右侧，间距与左对齐一致
    } else {
      labelX = p.l + layouts.reduce(function (acc, L) { return acc + L.advance; }, 0) + stripesW;
      stripesX0 = p.l;
    }
    var advAcc = 0;
    var entries = layouts.map(function (L, i) {
      var e = {
        number: L.num,
        color: L.color,
        stripeW: stripeW,
        advance: L.advance,
        font: Core.FONT_NUM,
        fontSize: s * NUM_FONT_RATIO,
        base: L.base,
        digits: L.digits,
        // 数字墨区顶与「号线」墨区顶齐平
      };
      if (right) {
        e.digitsX = p.l + advAcc;                 // 编号从内容左缘起排
        e.stripeX = stripesX0 + i * stripeW;      // 色块组按线路顺序并排
      } else {
        e.stripeX = p.l + i * stripeW + advAcc;   // 每条线路：色条在前、编号在后
        e.digitsX = e.stripeX + stripeW;
      }
      advAcc += L.advance;
      return e;
    });
    return {
      pad: p, size: s, stripeH: h - p.t, entries: entries, label: label,
      labelAlign: labelAlign,
      labelX: labelX,
      stripeX: stripesX0,
      width: right ? stripesX0 + stripesW + p.r : labelX + label.width + p.r,
    };
  }

  function textLineMetrics(el, h, m) {
    var p = contentBox(el.props.padding, h);
    var s = p.size;
    var stripeW = s * STRIPE_RATIO;             // 与数字线路同宽色条
    var gap = s / 8;                            // 大字两侧等距：色条→字 = 字→标签
    var right = el.props.align === 'right';     // 内容右对齐：色块移至右缘（镜像排版）
    var labelAlign = right ? 'right' : 'left';
    var stripeX, labelX, textCenterX, width;
    if (el.props.nameSink !== false) {          // 缺省视为开启（历史数据兼容）
      var fontSize = s;                         // 与数字线路的数字同视觉高度
      var textW = m(el.props.text, Core.FONT_ZH, 400, fontSize);
      var label = bilingualMetrics('线', el.props.textEn, s * LABEL_BOX_RATIO, m, false);
      if (right) {
        textCenterX = p.l + textW / 2;          // 大字移到内容左缘
        labelX = p.l + textW + gap;
        stripeX = labelX + label.width + gap;   // 色块移至右缘
        width = stripeX + stripeW + p.r;
      } else {
        textCenterX = p.l + stripeW + gap + textW / 2;
        labelX = p.l + stripeW + gap + textW + gap;
        stripeX = p.l;
        width = p.l + stripeW + gap + textW + gap + label.width + p.r;
      }
      return {
        pad: p, size: s, sink: true,
        stripeW: stripeW, stripeH: h - p.t, stripeX: stripeX,
        fontSize: fontSize, textW: textW,
        // 大字墨区顶与「线」标签墨区顶齐平（数字线路同理）
        base: p.t + label.zhBase - label.zhAscent + m.ascent(el.props.text, Core.FONT_ZH, 400, fontSize),
        textCenterX: textCenterX,
        gap: gap, label: label, labelX: labelX, labelAlign: labelAlign,
        width: width,
      };
    }
    // 平铺：完整线路名与「线 / 英文名」标签同字号（同一双语标签排版，盒高 0.75s），
    // 英文在下，中文显示输入全文
    var flat = bilingualMetrics(el.props.text, el.props.textEn, s * LABEL_BOX_RATIO, m, false);
    if (right) {
      labelX = p.l;                             // 完整线路名贴内容左缘
      stripeX = labelX + flat.width + gap;
      width = stripeX + stripeW + p.r;
    } else {
      labelX = p.l + stripeW + gap;
      stripeX = p.l;
      width = p.l + stripeW + gap + flat.width + p.r;
    }
    return {
      pad: p, size: s, sink: false,
      stripeW: stripeW, stripeH: h - p.t, stripeX: stripeX,
      gap: gap, label: flat, labelX: labelX, labelAlign: labelAlign,
      width: width,
    };
  }

  function codeLabelMetrics(el, h, m, labelZh, labelEn, alignable) {
    var p = contentBox(el.props.padding, h);
    var s = p.size;
    var size = s * NUM_FONT_RATIO;
    var codeW = m(el.props.code, Core.FONT_NUM, 400, size);
    var gap = s / 8;
    var label = bilingualMetrics(labelZh, labelEn, s * LABEL_BOX_RATIO, m, false);
    var right = alignable && el.props.align === 'right';
    // 编号基线公式两种模式一致（内容对齐仅镜像水平次序）
    var codeBase = p.t + label.zhBase - label.zhAscent + m.ascent(el.props.code, Core.FONT_NUM, 400, size);
    if (right) {
      return {
        pad: p, size: s, codeSize: size, codeW: codeW,
        codeBase: codeBase,
        codeCenterX: p.l + label.width + gap + codeW / 2, // 编号移至标签右侧
        gap: gap, label: label, labelX: p.l, labelAlign: 'right',
        width: p.l + label.width + gap + codeW + p.r,
      };
    }
    return {
      pad: p, size: s, codeSize: size, codeW: codeW,
      codeBase: codeBase,
      codeCenterX: p.l + codeW / 2,
      gap: gap, label: label, labelX: p.l + codeW + gap, labelAlign: 'left',
      width: p.l + codeW + gap + label.width + p.r,
    };
  }

  function entranceMetrics(el, h, m) {
    return codeLabelMetrics(el, h, m, '出入口', 'Entrance', false);
  }

  function exitMetrics(el, h, m) {
    return codeLabelMetrics(el, h, m, '出口', 'Exit', true);
  }

  function spaceMetrics(el, h, m) {
    return { width: el.props.widthRatio * h };
  }

  /** 图标为正方形：宽 = 内容尺寸 + 左右内边距 */
  function iconMetrics(el, h, m) {
    var p = contentBox(el.props.padding, h);
    var s = p.size;
    return { pad: p, size: s, width: s + p.l + p.r };
  }

  var METRICS_FNS = {
    'arrow': arrowMetrics,
    'bilingual-text': bilingualTextMetrics,
    'big-number': bigNumberMetrics,
    'number-line': numberLineMetrics,
    'text-line': textLineMetrics,
    'entrance': entranceMetrics,
    'exit': exitMetrics,
    'space': spaceMetrics,
    'icon': iconMetrics,
  };

  function elementMetrics(el, rowHeight, measure) {
    var fn = METRICS_FNS[el.type];
    if (!fn) throw new Error('未知元素类型: ' + el.type);
    return fn(el, rowHeight, measure);
  }

  function computeElementWidth(el, rowHeight, measure) {
    return elementMetrics(el, rowHeight, measure).width;
  }

  function computeRowWidth(row, rowHeight, measure) {
    return row.elements.reduce(function (acc, el) {
      return acc + computeElementWidth(el, rowHeight, measure);
    }, 0);
  }

  /** 动态宽度 = 最宽一行；全空时至少一个行高 */
  function computeSignWidth(sign, measure) {
    if (sign.widthMode === 'fixed') return sign.width;
    var w = sign.rowHeight;
    for (var i = 0; i < sign.rows.length; i++) {
      w = Math.max(w, computeRowWidth(sign.rows[i], sign.rowHeight, measure));
    }
    return Math.round(w);
  }

  /** 元素对齐属性（left|center|right），非法/缺失一律视为贴左 */
  function elementAlign(el) {
    return el.props && (el.props.elementAlign === 'center' || el.props.elementAlign === 'right')
      ? el.props.elementAlign : 'left';
  }

  /**
   * 行内元素水平布局。alignEnabled（固定宽度模式）时按元素对齐分三条独立通道：
   * 贴左从左缘流式排列、贴右从右缘流式排列、居中成组；通道间可能重叠（设计之内）。
   * 动态宽度模式一律左起排列。
   */
  function layoutRowElements(row, h, measure, signWidth, alignEnabled) {
    var slots = row.elements.map(function (el) {
      return { id: el.id, width: computeElementWidth(el, h, measure) };
    });
    var centerTotal = 0;
    var i, a;
    if (alignEnabled) {
      for (i = 0; i < row.elements.length; i++) {
        if (elementAlign(row.elements[i]) === 'center') centerTotal += slots[i].width;
      }
    }
    var leftX = 0;
    var rightX = signWidth;
    var centerX = (signWidth - centerTotal) / 2;
    for (i = 0; i < row.elements.length; i++) {
      a = alignEnabled ? elementAlign(row.elements[i]) : 'left';
      if (a === 'right') {
        rightX -= slots[i].width;
        slots[i].x = rightX;
      } else if (a === 'center') {
        slots[i].x = centerX;
        centerX += slots[i].width;
      } else {
        slots[i].x = leftX;
        leftX += slots[i].width;
      }
    }
    return slots;
  }

  /** 完整布局：每行 y、每元素 x/width */
  function layoutSign(sign, measure) {
    var h = sign.rowHeight;
    var width = computeSignWidth(sign, measure);
    var height = h * sign.rows.length;
    var alignEnabled = sign.widthMode === 'fixed';
    var rows = sign.rows.map(function (row, ri) {
      var elements = layoutRowElements(row, h, measure, width, alignEnabled);
      var contentWidth = elements.reduce(function (acc, s) { return acc + s.width; }, 0);
      return { id: row.id, y: ri * h, height: h, elements: elements, contentWidth: contentWidth };
    });
    return { width: width, height: height, rows: rows };
  }

  // ══════════════════════════════════════════════════════════
  // SVG DOM 绘制（仅浏览器）
  // ══════════════════════════════════════════════════════════

  function mk(tag, attrs) {
    var e = document.createElementNS(Core.SVG_NS, tag);
    for (var k in attrs) {
      if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    }
    return e;
  }

  function mkText(content, attrs) {
    var t = mk('text', attrs);
    t.textContent = content;
    return t;
  }

  function polygonPoints(pts) {
    return pts.map(function (p) { return p[0].toFixed(2) + ',' + p[1].toFixed(2); }).join(' ');
  }

  /**
   * 双语双行文本的对齐 x 坐标（纯函数）。
   * label 为 bilingualMetrics 结果，其 width 必须是纯文本区宽度（不含 padding）；
   * indent 为英文左右对齐时的额外缩进像素。
   */
  function bilingualAlignX(label, x, align, indent) {
    if (align === 'left') {
      return { zhX: x, enX: x + indent };
    }
    if (align === 'right') {
      return {
        zhX: x + label.width - label.zhW,
        enX: x + label.width - label.enW - indent,
      };
    }
    return {
      zhX: x + (label.width - label.zhW) / 2,
      enX: x + (label.width - label.enW) / 2,
    };
  }

  /**
   * 通用双语双行文本绘制。
   * label: bilingualMetrics 结果；x: 文本区左缘；top: 内容盒顶部 y；
   * align: left|center|right；indentScale: 左右对齐时英文额外缩进的基数（内容尺寸 s）
   */
  function drawBilingualBox(g, textZh, textEn, label, x, top, color, align, indentScale) {
    var pos = bilingualAlignX(label, x, align, indentScale * EN_ALIGN_OFFSET);
    g.appendChild(mkText(textZh, {
      x: pos.zhX, y: top + label.zhBase,
      'font-family': Core.FONT_ZH, 'font-size': label.zhSize,
      'font-weight': label.weight, fill: color,
    }));
    g.appendChild(mkText(textEn, {
      x: pos.enX, y: top + label.enBase,
      'font-family': Core.FONT_EN, 'font-size': label.enSize,
      'font-weight': label.weight, fill: color,
    }));
  }

  // 各元素绘制函数：在局部坐标（元素盒原点）内绘制。
  // 签名 (g, el, mt)：mt 为 renderElement 已算好的该元素 metrics，
  // draw 不得再调用 metrics 函数（同一元素每次渲染只测量一次，且坐标只有一套来源）。
  var DRAW_FNS;

  function drawArrow(g, el, mt) {
    var ox = mt.offset.x, oy = mt.offset.y;
    [mt.geo.head1, mt.geo.head2, mt.geo.shaft].forEach(function (poly) {
      g.appendChild(mk('polygon', {
        points: polygonPoints(poly.map(function (p) { return [p[0] + ox, p[1] + oy]; })),
        fill: el.props.color,
      }));
    });
  }

  function drawBilingualText(g, el, mt) {
    // 对齐基准是纯文本区宽度；mt.width 已含 padding，须换回 textW 视图，
    // 否则右/居中对齐会把文字推出内容盒（越出选中虚线框）。
    var label = {
      width: mt.textW, zhW: mt.zhW, enW: mt.enW,
      zhSize: mt.zhSize, enSize: mt.enSize,
      zhBase: mt.zhBase, enBase: mt.enBase, weight: mt.weight,
    };
    drawBilingualBox(g, el.props.textZh, el.props.textEn, label, mt.pad.l, mt.pad.t,
      el.props.color, el.props.align, mt.pad.size);
  }

  function drawBigNumber(g, el, mt) {
    g.appendChild(mkText(el.props.text, {
      x: mt.pad.l + mt.textW / 2, y: mt.base,
      'text-anchor': 'middle',
      'font-family': Core.FONT_NUM, 'font-size': mt.fontSize, fill: el.props.color,
    }));
  }

  function drawNumberLine(g, el, mt) {
    mt.entries.forEach(function (e) {
      g.appendChild(mk('rect', {
        x: e.stripeX, y: mt.pad.t, width: e.stripeW, height: mt.stripeH, fill: e.color,
      }));
      e.digits.forEach(function (d) {
        g.appendChild(mkText(d.ch, {
          x: e.digitsX + d.x, y: e.base,
          'text-anchor': 'middle',
          'font-family': e.font, 'font-size': e.fontSize, fill: el.props.textColor,
        }));
      });
    });
    drawBilingualBox(g, '号线', 'Line', mt.label, mt.labelX, mt.pad.t, el.props.textColor, mt.labelAlign, 0);
  }

  function drawTextLine(g, el, mt) {
    // 贯穿色条：内容顶 → 行底，同数字线路；内容右对齐时位于元素右缘
    g.appendChild(mk('rect', {
      x: mt.stripeX, y: mt.pad.t, width: mt.stripeW, height: mt.stripeH,
      fill: el.props.blockColor,
    }));
    if (!mt.sink) {
      // 平铺：完整线路名（标签级字号）+ 英文名在下，无「线」后缀
      drawBilingualBox(g, el.props.text, el.props.textEn, mt.label, mt.labelX, mt.pad.t,
        el.props.textColor, mt.labelAlign, 0);
      return;
    }
    // 大字（思源黑体）占据数字线路中数字的位置，用文字颜色而非色条对比色
    g.appendChild(mkText(el.props.text, {
      x: mt.textCenterX, y: mt.base,
      'text-anchor': 'middle',
      'font-family': Core.FONT_ZH, 'font-size': mt.fontSize,
      fill: el.props.textColor,
    }));
    drawBilingualBox(g, '线', el.props.textEn, mt.label, mt.labelX, mt.pad.t, el.props.textColor, mt.labelAlign, 0);
  }

  function drawCodeLabel(g, el, mt, labelZh, labelEn) {
    g.appendChild(mkText(el.props.code, {
      x: mt.codeCenterX, y: mt.codeBase,
      'text-anchor': 'middle',
      'font-family': Core.FONT_NUM, 'font-size': mt.codeSize, fill: el.props.color,
    }));
    drawBilingualBox(g, labelZh, labelEn, mt.label, mt.labelX, mt.pad.t, el.props.color, mt.labelAlign, 0);
  }

  function drawEntrance(g, el, mt) {
    drawCodeLabel(g, el, mt, '出入口', 'Entrance');
  }

  function drawExit(g, el, mt) {
    drawCodeLabel(g, el, mt, '出口', 'Exit');
  }

  function drawSpace() { /* 空白占位，无可见内容 */ }

  function drawIcon(g, el, mt) {
    var lib = global.SignIcons;
    if (!HAS_DOM || !lib) return;
    var icon = lib.get(el.props.icon);
    var color = el.props.color || '#000000';
    var nested = mk('svg', {
      x: mt.pad.l, y: mt.pad.t, width: mt.size, height: mt.size,
      viewBox: icon.vb, preserveAspectRatio: 'xMidYMid meet',
    });
    nested.innerHTML = icon.body.replace(/fill="black"/g, 'fill="' + color + '"');
    g.appendChild(nested);
  }

  DRAW_FNS = {
    'arrow': drawArrow,
    'bilingual-text': drawBilingualText,
    'big-number': drawBigNumber,
    'number-line': drawNumberLine,
    'text-line': drawTextLine,
    'entrance': drawEntrance,
    'exit': drawExit,
    'space': drawSpace,
    'icon': drawIcon,
  };

  /**
   * 渲染单个元素为 <g>（局部坐标）。clean=true 时不带编辑器属性与命中框（用于导出/缩略图）。
   */
  function renderElement(el, rowHeight, measure, options) {
    var opts = options || {};
    var g = mk('g', { class: 'element' });
    if (!opts.clean) {
      g.setAttribute('data-element-id', el.id);
    }
    var mt = elementMetrics(el, rowHeight, measure);
    var w = Math.max(mt.width, 1);
    // 元素背景色（含 padding 区，覆盖整个元素盒）
    var bg = el.props.backgroundColor;
    if (bg) {
      g.appendChild(mk('rect', { x: 0, y: 0, width: w, height: rowHeight, fill: bg }));
    }
    (DRAW_FNS[el.type] || drawSpace)(g, el, mt);
    if (!opts.clean) {
      g.appendChild(mk('rect', {
        class: 'hitbox', x: 0, y: 0, width: w, height: rowHeight,
        fill: 'transparent', 'pointer-events': 'all',
      }));
    }
    return { node: g, width: w };
  }

  /** 标识牌灰框：从行边界向内的四条矩形（左右通高、上下通宽），模拟真实牌面边框。
   *  渲染在所有元素之上（遮挡越界内容）；pointer-events 关闭，不拦截元素点击。 */
  function appendFrameRects(g, signWidth, rowY, rowHeight, fw) {
    var strips = [
      { x: 0, y: rowY, width: fw, height: rowHeight },                  // 左
      { x: signWidth - fw, y: rowY, width: fw, height: rowHeight },     // 右
      { x: 0, y: rowY, width: signWidth, height: fw },                  // 上
      { x: 0, y: rowY + rowHeight - fw, width: signWidth, height: fw }, // 下
    ];
    strips.forEach(function (s) {
      var attrs = Object.assign({ class: 'sign-frame', fill: Core.SIGN_FRAME_COLOR }, s);
      attrs['pointer-events'] = 'none';
      g.appendChild(mk('rect', attrs));
    });
  }

  /**
   * 将整个标识牌渲染进 <svg> 元素（原地清空重绘）。
   * opts: { selectedElementId, clean }
   * 返回 layout（见 layoutSign）。
   */
  function renderSignInto(svg, sign, measure, opts) {
    var options = opts || {};
    var layout = layoutSign(sign, measure);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', '0 0 ' + layout.width + ' ' + layout.height);
    svg.setAttribute('xmlns', Core.SVG_NS);
    svg.appendChild(mk('rect', {
      class: 'sign-bg', x: 0, y: 0,
      width: layout.width, height: layout.height, fill: sign.backgroundColor,
    }));
    for (var ri = 0; ri < sign.rows.length; ri++) {
      var row = sign.rows[ri];
      var rowLayout = layout.rows[ri];
      var rowG = mk('g', { class: 'sign-row' });
      if (!options.clean) rowG.setAttribute('data-row-id', row.id);
      for (var ei = 0; ei < row.elements.length; ei++) {
        var el = row.elements[ei];
        var rendered = renderElement(el, sign.rowHeight, measure, { clean: options.clean });
        rendered.node.setAttribute('transform', 'translate(' + rowLayout.elements[ei].x + ',' + rowLayout.y + ')');
        if (options.selectedElementId === el.id) {
          rendered.node.setAttribute('class', 'element selected');
        }
        if (!options.clean) {
          rendered.node.setAttribute('data-row-id', row.id);
        }
        rowG.appendChild(rendered.node);
      }
      // 灰框在所有元素之上（真实边框遮挡越界内容），pointer-events 关闭不影响点击
      if (sign.frameWidth > 0) {
        appendFrameRects(rowG, layout.width, rowLayout.y, sign.rowHeight, sign.frameWidth);
      }
      svg.appendChild(rowG);
    }
    return layout;
  }

  /** 生成独立 <svg> 元素（缩略图用，非交互） */
  function renderElementStandalone(el, rowHeight, measure, maxWidth) {
    var mt = elementMetrics(el, rowHeight, measure);
    var w = Math.max(mt.width, 1);
    var svg = mk('svg', {
      viewBox: '0 0 ' + w + ' ' + rowHeight,
      xmlns: Core.SVG_NS,
    });
    if (maxWidth) svg.setAttribute('width', Math.min(w, maxWidth));
    var rendered = renderElement(el, rowHeight, measure, { clean: true });
    svg.appendChild(rendered.node);
    return { node: svg, width: w, height: rowHeight };
  }

  global.SignRender = {
    ZH_FONT_RATIO: ZH_FONT_RATIO,
    EN_FONT_RATIO: EN_FONT_RATIO,
    ZH_BASE_RATIO: ZH_BASE_RATIO,
    EN_BASE_RATIO: EN_BASE_RATIO,
    NUM_FONT_RATIO: NUM_FONT_RATIO,
    NUM_BASE_RATIO: NUM_BASE_RATIO,
    STRIPE_RATIO: STRIPE_RATIO,
    contentBox: contentBox,
    arrowGeometry: arrowGeometry,
    bilingualMetrics: bilingualMetrics,
    bilingualAlignX: bilingualAlignX,
    elementMetrics: elementMetrics,
    computeElementWidth: computeElementWidth,
    computeRowWidth: computeRowWidth,
    computeSignWidth: computeSignWidth,
    layoutSign: layoutSign,
    renderElement: renderElement,
    renderSignInto: renderSignInto,
    renderElementStandalone: renderElementStandalone,
  };
})(typeof window !== 'undefined' ? window : globalThis);
