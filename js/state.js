/**
 * state.js — SignState 状态模型纯函数
 *
 * 所有变更函数返回新对象，绝不修改传入状态（不可变更新）。
 * 数据模型（PRD）：
 *   SignState { widthMode, width, rowHeight, aspectLocked, backgroundColor, rows }
 *   Row   { id, elements }
 *   Element { id, type, props }
 *
 * padding 为比例值（相对行高），渲染时乘以行高得到像素。
 * 本文件不依赖 DOM，可在 Node 中加载测试。
 */
(function (global) {
  'use strict';

  var Core = global.SignCore;
  var uuid = Core.uuid;

  var ELEMENT_TYPES = [
    'arrow', 'bilingual-text', 'big-number', 'number-line',
    'text-line', 'entrance', 'exit', 'space', 'icon',
  ];

  // 支持内容对齐（align: left|right，元素内部镜像排版）的元素类型
  var CONTENT_ALIGN_TYPES = ['number-line', 'text-line', 'exit'];

  // 各元素类型默认属性。padding 一律为相对行高的比例。
  // elementAlign 为固定宽度模式下的元素对齐（left|center|right），动态宽度忽略；
  // 双语文本的 align 是其文字对齐，与元素对齐相互独立。
  var DEFAULT_PROPS = {
    'arrow': {
      direction: 'left',            // up|down|left|right|left-up|right-up|right-down|left-down
      color: '#000000',
      thicknessRatio: 0.25,         // 相对内容尺寸
      backgroundColor: null,        // null = 透明
      elementAlign: 'left',
      padding: { top: 0.2, right: 0.2, bottom: 0.2, left: 0.2 },
    },
    'bilingual-text': {
      textZh: '站名',
      textEn: 'Station',
      color: '#000000',
      bold: false,
      align: 'center',              // 文字对齐（left|center|right）
      backgroundColor: null,
      elementAlign: 'left',
      padding: { top: 0.2, right: 0.2, bottom: 0.2, left: 0.2 },
    },
    'big-number': {
      text: '1',
      color: '#000000',
      backgroundColor: null,
      elementAlign: 'left',
      padding: { top: 0.2, right: 0.2, bottom: 0.2, left: 0.2 },
    },
    'number-line': {
      lines: [{ number: '1', color: '#E4002B' }],   // 默认重庆地铁 1 号线红
      textColor: '#000000',
      align: 'left',                // 内容对齐（left|right）：右对齐时色块移至右缘，仅渲染第 1 条线路
      backgroundColor: null,
      elementAlign: 'left',
      padding: { top: 0.2, right: 0.2, bottom: 0.2, left: 0.2 },
    },
    'text-line': {
      text: '环',                   // 色条右侧大字（思源黑体）
      textEn: 'Loop Line',          // 英文线路名，与「线」组合显示
      nameSink: true,               // 线路名下沉：大字显示并与「线」组合；关闭则与「线」同字号完整显示
      blockColor: '#F2A900',        // 贯穿色条颜色（默认重庆环线黄）
      textColor: '#000000',
      align: 'left',                // 内容对齐（left|right）：右对齐时色块移至右缘
      backgroundColor: null,
      elementAlign: 'left',
      padding: { top: 0.2, right: 0.2, bottom: 0.2, left: 0.2 },
    },
    'entrance': {
      code: '1',
      color: '#000000',
      backgroundColor: null,
      elementAlign: 'left',
      padding: { top: 0.2, right: 0.2, bottom: 0.2, left: 0.2 },
    },
    'exit': {
      code: '1',
      color: '#000000',
      align: 'left',                // 内容对齐（left|right）：右对齐时编号移至「出口」右侧
      backgroundColor: Core.EXIT_COLOR, // 出口背景色固定出口黄
      elementAlign: 'left',
      padding: { top: 0.2, right: 0.2, bottom: 0.2, left: 0.2 },
    },
    'space': {
      widthRatio: 0.5,              // 宽度 = 行高 × 此比例
      backgroundColor: null,        // null = 透明，可选背景色
      elementAlign: 'left',
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
    },
    'icon': {
      icon: 'elevator',             // 图标 id，见 js/icons.js
      color: '#000000',
      backgroundColor: null,
      elementAlign: 'left',
      padding: { top: 0.2, right: 0.2, bottom: 0.2, left: 0.2 },
    },
  };

  // ─── 工厂 ──────────────────────────────────────────────────

  function createRow(elements) {
    return { id: uuid(), elements: elements ? elements.slice() : [] };
  }

  function createElement(type, props) {
    var base = Core.deepClone(DEFAULT_PROPS[type] || {});
    if (props) {
      if (props.padding) {
        base.padding = Object.assign({}, base.padding, props.padding);
      }
      var copy = Object.assign({}, props);
      delete copy.padding;
      Object.assign(base, copy);
    }
    return { id: uuid(), type: type, props: base };
  }

  function createSign() {
    return {
      widthMode: 'fixed',           // fixed | dynamic
      width: 2048,
      rowHeight: 256,
      aspectLocked: false,
      backgroundColor: '#FFFFFF',
      frameWidth: 0,                // 灰框宽度（px），从牌面边界向内；0 = 不显示
      rows: [createRow()],
    };
  }

  // ─── 行操作 ────────────────────────────────────────────────

  /** 在 index 处插入新空行（缺省追加到末尾） */
  function addRow(sign, index) {
    var rows = sign.rows.slice();
    var i = index === undefined ? rows.length : Core.clamp(index, 0, rows.length);
    rows.splice(i, 0, createRow());
    return Object.assign({}, sign, { rows: rows });
  }

  /** 删除行；仅剩一行时不做任何事（标识牌至少保留一行） */
  function deleteRow(sign, rowId) {
    if (sign.rows.length <= 1) return sign;
    var idx = -1;
    for (var i = 0; i < sign.rows.length; i++) {
      if (sign.rows[i].id === rowId) { idx = i; break; }
    }
    if (idx === -1) return sign;
    var rows = sign.rows.slice();
    rows.splice(idx, 1);
    return Object.assign({}, sign, { rows: rows });
  }

  /** 移动行顺序（fromIndex/toIndex 均为当前数组下标） */
  function moveRow(sign, fromIndex, toIndex) {
    var n = sign.rows.length;
    if (fromIndex < 0 || fromIndex >= n || toIndex < 0 || toIndex >= n || fromIndex === toIndex) {
      return sign;
    }
    var rows = sign.rows.slice();
    var row = rows.splice(fromIndex, 1)[0];
    rows.splice(toIndex, 0, row);
    return Object.assign({}, sign, { rows: rows });
  }

  // ─── 元素操作 ──────────────────────────────────────────────

  /** 向指定行插入元素（缺省追加到末尾） */
  function addElement(sign, rowId, element, index) {
    var rows = sign.rows.map(function (row) {
      if (row.id !== rowId) return row;
      var els = row.elements.slice();
      var i = index === undefined ? els.length : Core.clamp(index, 0, els.length);
      els.splice(i, 0, element);
      return Object.assign({}, row, { elements: els });
    });
    return Object.assign({}, sign, { rows: rows });
  }

  /** 删除元素（按 id，全牌搜索） */
  function deleteElement(sign, elementId) {
    var rows = sign.rows.map(function (row) {
      if (!row.elements.some(function (e) { return e.id === elementId; })) return row;
      return Object.assign({}, row, {
        elements: row.elements.filter(function (e) { return e.id !== elementId; }),
      });
    });
    return Object.assign({}, sign, { rows: rows });
  }

  /**
   * 移动元素（同行排序或跨行移动）。
   * gapIndex 为"当前布局中的落点间隙序号"：目标行内、位于第 gapIndex 个元素之前，
   * 其语义以拖拽时看到的行内容为准（若同行的源元素在落点之前，内部自动回退一位）。
   */
  function moveElement(sign, elementId, toRowId, gapIndex) {
    var found = findElement(sign, elementId);
    if (!found) return sign;
    var fromRowId = found.rowId;
    var sourceIndex = found.index;

    var rows = sign.rows.map(function (row) {
      if (row.id === fromRowId) {
        return Object.assign({}, row, {
          elements: row.elements.filter(function (e) { return e.id !== elementId; }),
        });
      }
      return row;
    });

    var target = Core.clamp(gapIndex, 0, Infinity);
    if (fromRowId === toRowId && sourceIndex < gapIndex) target = gapIndex - 1;

    rows = rows.map(function (row) {
      if (row.id !== toRowId) return row;
      var i = Core.clamp(target, 0, row.elements.length);
      var els = row.elements.slice();
      els.splice(i, 0, found.element);
      return Object.assign({}, row, { elements: els });
    });

    return Object.assign({}, sign, { rows: rows });
  }

  /** 更新元素属性（浅合并 patch；padding 单独深合并一层） */
  function updateElementProps(sign, elementId, patch) {
    var rows = sign.rows.map(function (row) {
      var hit = row.elements.some(function (e) { return e.id === elementId; });
      if (!hit) return row;
      return Object.assign({}, row, {
        elements: row.elements.map(function (e) {
          if (e.id !== elementId) return e;
          var props = Object.assign({}, e.props, patch);
          if (patch.padding) {
            props.padding = Object.assign({}, e.props.padding, patch.padding);
          }
          return Object.assign({}, e, { props: props });
        }),
      });
    });
    return Object.assign({}, sign, { rows: rows });
  }

  /** 全牌搜索元素，返回 { rowId, rowIndex, index, element } 或 null */
  function findElement(sign, elementId) {
    for (var ri = 0; ri < sign.rows.length; ri++) {
      var row = sign.rows[ri];
      for (var ei = 0; ei < row.elements.length; ei++) {
        if (row.elements[ei].id === elementId) {
          return { rowId: row.id, rowIndex: ri, index: ei, element: row.elements[ei] };
        }
      }
    }
    return null;
  }

  // ─── 标识牌设置 ────────────────────────────────────────────

  /**
   * 更新标识牌设置。锁定宽高比时（以补丁生效后的开关状态为准）：
   *   - 改 rowHeight → width 等比缩放
   *   - 改 width     → rowHeight 等比缩放
   */
  function updateSignSettings(sign, patch) {
    var next = Object.assign({}, sign, patch);
    if (next.aspectLocked && patch.rowHeight !== undefined && patch.rowHeight !== sign.rowHeight) {
      next.width = Math.round(sign.width * (next.rowHeight / sign.rowHeight));
    } else if (next.aspectLocked && patch.width !== undefined && patch.width !== sign.width) {
      next.rowHeight = Math.round(sign.rowHeight * (next.width / sign.width));
    }
    return next;
  }

  /** 清空标识牌：保留设置，恢复为一行空白 */
  function clearSign(sign) {
    return Object.assign({}, sign, { rows: [createRow()] });
  }

  // ─── 序列化 / 反序列化 ─────────────────────────────────────

  var SCHEMA_VERSION = 1;

  function serializeSign(sign) {
    return JSON.stringify({ version: SCHEMA_VERSION, sign: sign });
  }

  function isPlainObject(v) {
    return Object.prototype.toString.call(v) === '[object Object]';
  }

  // padding 上限（相对行高比例）：上下受内容盒高度约束 ≤1；左右只影响元素宽度，可更大
  var PADDING_MAX = { top: 1, right: 8, bottom: 1, left: 8 };

  function sanitizePadding(p) {
    var base = { top: 0, right: 0, bottom: 0, left: 0 };
    if (!isPlainObject(p)) return base;
    ['top', 'right', 'bottom', 'left'].forEach(function (k) {
      var n = Number(p[k]);
      if (isFinite(n)) base[k] = Core.clamp(n, 0, PADDING_MAX[k]);
    });
    return base;
  }

  function sanitizeColor(c, fallback) {
    return Core.normalizeHex(c) || fallback;
  }

  /** 文本属性强制字符串：null/undefined 回默认，其余 String 化（渲染层只认字符串） */
  function sanitizeText(v, fallback) {
    if (typeof v === 'string') return v;
    return v === undefined || v === null ? fallback : String(v);
  }

  /** 数值属性：非有限数回默认，否则夹到 [lo, hi] */
  function sanitizeNumber(v, lo, hi, fallback) {
    var n = Number(v);
    return isFinite(n) ? Core.clamp(n, lo, hi) : fallback;
  }

  var ARROW_DIRECTIONS = [
    'up', 'down', 'left', 'right', 'left-up', 'right-up', 'right-down', 'left-down',
  ];

  /**
   * 数字线路列表：必须收敛为 [{ number: string, color: #RRGGBB }]。
   * 非数组的 lines 会让渲染层 .map 崩溃（历史导入崩溃点）；非对象项剔除；
   * 空数组合法（面板允许移除全部线路）。
   */
  function sanitizeLines(v) {
    if (!Array.isArray(v)) return Core.deepClone(DEFAULT_PROPS['number-line'].lines);
    return v.filter(isPlainObject).map(function (l) {
      return {
        number: sanitizeText(l.number, ''),
        color: sanitizeColor(l.color, '#424A52'),
      };
    });
  }

  /** 校验并修补单个元素：未知类型返回 null。
   *  反序列化是外部数据的唯一入口，凡渲染层假定过的形状（数组/数值/枚举/字符串）
   *  都必须在此收敛，否则一份手改的项目 JSON 就能让整牌渲染崩溃。 */
  function sanitizeElement(el) {
    if (!isPlainObject(el) || ELEMENT_TYPES.indexOf(el.type) === -1) return null;
    var defaults = DEFAULT_PROPS[el.type];
    var props = Object.assign(Core.deepClone(defaults), isPlainObject(el.props) ? el.props : {});
    props.padding = sanitizePadding(props.padding);
    if (props.color !== undefined) props.color = sanitizeColor(props.color, '#000000');
    if (props.backgroundColor !== undefined && props.backgroundColor !== null) {
      props.backgroundColor = sanitizeColor(props.backgroundColor, null);
    }
    if (el.type === 'exit') props.backgroundColor = Core.EXIT_COLOR;
    if (props.elementAlign !== 'center' && props.elementAlign !== 'right') props.elementAlign = 'left';
    // 内容对齐仅这三类元素支持，且只有 left|right 两档；双语文本的 align（left|center|right）不受影响
    if (CONTENT_ALIGN_TYPES.indexOf(el.type) !== -1 && props.align !== 'right') props.align = 'left';
    if (el.type === 'icon' && typeof props.icon !== 'string') props.icon = 'elevator';

    if (el.type === 'arrow') {
      if (ARROW_DIRECTIONS.indexOf(props.direction) === -1) props.direction = 'left';
      props.thicknessRatio = sanitizeNumber(props.thicknessRatio, 0.05, 0.95, defaults.thicknessRatio);
    } else if (el.type === 'bilingual-text') {
      props.textZh = sanitizeText(props.textZh, defaults.textZh);
      props.textEn = sanitizeText(props.textEn, defaults.textEn);
      props.bold = !!props.bold;
      if (props.align !== 'left' && props.align !== 'right') props.align = 'center';
    } else if (el.type === 'big-number') {
      props.text = sanitizeText(props.text, defaults.text);
    } else if (el.type === 'number-line') {
      props.lines = sanitizeLines(props.lines);
      props.textColor = sanitizeColor(props.textColor, '#000000');
    } else if (el.type === 'text-line') {
      props.text = sanitizeText(props.text, defaults.text);
      props.textEn = sanitizeText(props.textEn, defaults.textEn);
      props.nameSink = props.nameSink !== false; // 缺省视为开启（历史数据兼容）
      props.blockColor = sanitizeColor(props.blockColor, defaults.blockColor);
      props.textColor = sanitizeColor(props.textColor, '#000000');
    } else if (el.type === 'entrance' || el.type === 'exit') {
      props.code = sanitizeText(props.code, defaults.code);
    } else if (el.type === 'space') {
      props.widthRatio = sanitizeNumber(props.widthRatio, 0, 8, defaults.widthRatio);
    }
    return {
      id: typeof el.id === 'string' && el.id ? el.id : uuid(),
      type: el.type,
      props: props,
    };
  }

  /**
   * 反序列化并校验 SignState。结构不合法时抛出 Error（中文消息）。
   * 尽量宽容：缺失的 props 以默认值补齐，颜色规范化。
   */
  function deserializeSign(json) {
    var data;
    if (typeof json === 'string') {
      data = JSON.parse(json); // 解析失败自然抛出
    } else {
      data = json;
    }
    if (!isPlainObject(data)) throw new Error('项目文件不是有效的 JSON 对象');
    var sign = isPlainObject(data.sign) ? data.sign : data;

    if (!Array.isArray(sign.rows)) throw new Error('缺少 rows 数组');
    if (sign.rows.length === 0) throw new Error('rows 不能为空');

    var widthMode = sign.widthMode === 'dynamic' ? 'dynamic' : 'fixed';
    var width = Math.round(Number(sign.width));
    if (!isFinite(width) || width < 64 || width > 32768) width = 2048;
    var rowHeight = Math.round(Number(sign.rowHeight));
    if (!isFinite(rowHeight) || rowHeight < 32 || rowHeight > 2048) rowHeight = 256;
    var frameWidth = Math.round(Number(sign.frameWidth));
    if (!isFinite(frameWidth) || frameWidth < 0) frameWidth = 0;
    if (frameWidth > 512) frameWidth = 512;

    var seenRowIds = {};
    var seenElementIds = {};
    /** 重复 id 会让 data-element-id 查询与选中态指向歧义节点，重新生成 */
    function pickUniqueId(id, seen) {
      var usable = typeof id === 'string' && id && !seen[id];
      var final = usable ? id : uuid();
      seen[final] = true;
      return final;
    }

    var rows = sign.rows.map(function (row) {
      if (!isPlainObject(row) || !Array.isArray(row.elements)) {
        throw new Error('存在无效的行');
      }
      var elements = [];
      row.elements.forEach(function (el) {
        var ok = sanitizeElement(el);
        if (ok) {
          ok.id = pickUniqueId(ok.id, seenElementIds);
          elements.push(ok);
        }
      });
      return {
        id: pickUniqueId(row.id, seenRowIds),
        elements: elements,
      };
    });

    return {
      widthMode: widthMode,
      width: width,
      rowHeight: rowHeight,
      aspectLocked: !!sign.aspectLocked,
      backgroundColor: sanitizeColor(sign.backgroundColor, '#FFFFFF'),
      frameWidth: frameWidth,
      rows: rows,
    };
  }

  global.SignState = {
    ELEMENT_TYPES: ELEMENT_TYPES,
    DEFAULT_PROPS: DEFAULT_PROPS,
    SCHEMA_VERSION: SCHEMA_VERSION,
    createSign: createSign,
    createRow: createRow,
    createElement: createElement,
    addRow: addRow,
    deleteRow: deleteRow,
    moveRow: moveRow,
    addElement: addElement,
    deleteElement: deleteElement,
    moveElement: moveElement,
    updateElementProps: updateElementProps,
    updateSignSettings: updateSignSettings,
    findElement: findElement,
    clearSign: clearSign,
    serializeSign: serializeSign,
    deserializeSign: deserializeSign,
  };
})(typeof window !== 'undefined' ? window : globalThis);
