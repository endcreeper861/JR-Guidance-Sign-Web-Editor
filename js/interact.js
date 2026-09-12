/**
 * interact.js — 编辑区交互层
 *
 * 覆盖层（HTML）承载行手柄/行按钮/拖放指示器，SVG 保持纯净可导出。
 * 指针输入统一走 Pointer Events（一套代码服务鼠标 + 触屏 + 笔），
 * 拖拽会话按 pointerId 锁定；HTML5 DnD 仅桌面（移动端走点击添加）。
 * - 点击元素选中 / 点击空白取消选中
 * - 元素指针拖拽：行内排序 + 跨行移动（插入指示器 + 幽灵副本）
 * - 行手柄"≡"拖拽：整行排序（仅行数 > 1）
 * - 左栏卡片/预设 HTML5 拖放：新元素入行 / 预设替换空行
 * - 行管理：添加行 / 删除行（确认）/ 存为预设
 * - 触屏手势（仅 ≤768px 移动布局）：pinch 缩放画布 / 单指平移 / 双击复位
 */
(function (global) {
  'use strict';

  var Core = global.SignCore;
  var State = global.SignState;
  var UI = global.SignUI;
  var App = global.App;
  var h = UI.h;

  var overlay, svg, elIndicator, rowIndicator, canvasScroll, zoomBadge;
  var suppressClick = false;

  var MIME_NEW = 'application/x-sign-new';
  var MIME_PRESET = 'application/x-sign-preset';

  function init() {
    overlay = document.getElementById('sign-overlay');
    svg = document.getElementById('sign-svg');
    canvasScroll = document.getElementById('canvas-scroll');
    zoomBadge = document.getElementById('zoom-badge');

    elIndicator = h('div', { id: 'element-drop-indicator' });
    rowIndicator = h('div', { id: 'row-drop-indicator' });
    overlay.appendChild(elIndicator);
    overlay.appendChild(rowIndicator);

    // Pointer Events 一套代码服务鼠标 + 触屏 + 笔（会话按 pointerId 锁定）
    svg.addEventListener('pointerdown', onElementPointerDown);
    svg.addEventListener('click', onSvgClick);
    document.addEventListener('keydown', onKeyDown);
    document.getElementById('add-row-btn').addEventListener('click', function () {
      App.update(State.addRow);
    });

    var wrap = document.getElementById('canvas-wrap');
    wrap.addEventListener('dragover', onPaletteDragOver);
    wrap.addEventListener('drop', onPaletteDrop);
    wrap.addEventListener('dragleave', onPaletteDragLeave);

    // 触屏画布手势（pinch 缩放 / 平移 / 双击复位），见文末手势段
    canvasScroll.addEventListener('pointerdown', onGesturePointerDown);
    canvasScroll.addEventListener('pointermove', onGesturePointerMove);
    canvasScroll.addEventListener('pointerup', onGesturePointerUp);
    canvasScroll.addEventListener('pointercancel', onGesturePointerCancel);

    zoomBadge.addEventListener('click', function () { setCanvasZoom(1); });
    updateZoomBadge();
  }

  // ─── 覆盖层渲染 ────────────────────────────────────────────

  function renderOverlay(layout, state) {
    // 保留两个指示器（挂在 overlay 底部），清掉其余
    Array.prototype.slice.call(overlay.children).forEach(function (child) {
      if (child !== elIndicator && child !== rowIndicator) child.remove();
    });
    hideIndicators();

    // 移动端行控件外置到 #row-strip：行带内悬浮控件会与牌面元素互相叠加
    var mobile = App.isMobileView && App.isMobileView();
    var totalH = layout.height || 1;
    state.rows.forEach(function (row, i) {
      var rl = layout.rows[i];
      var band = h('div', {
        class: 'row-band',
        'data-row-index': i,
        style: {
          top: (rl.y / totalH * 100) + '%',
          height: (rl.height / totalH * 100) + '%',
        },
      });

      if (!mobile && state.rows.length > 1) {
        var handle = h('div', { class: 'row-handle', title: '拖动调整行顺序', text: '≡' });
        handle.addEventListener('pointerdown', function (ev) {
          // 鼠标按原行为阻止选择/拖拽；触屏靠 touch-action/user-select（且避免个别浏览器吞 click）
          if (ev.pointerType === 'mouse') ev.preventDefault();
          ev.stopPropagation();
          startRowDrag(ev, i);
        });
        band.appendChild(handle);
      }

      if (!mobile) {
        var actions = h('div', { class: 'row-actions' });
        var saveBtn = h('button', { text: '⭐ 存为预设', title: '将此行保存为预设' });
        saveBtn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          saveRowAsPreset(i);
        });
        var delBtn = h('button', {
          class: 'row-del', text: '✕ 删除行',
          title: state.rows.length > 1 ? '删除此行' : '至少保留一行',
        });
        if (state.rows.length <= 1) delBtn.disabled = true;
        delBtn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          confirmDeleteRow(i);
        });
        actions.appendChild(saveBtn);
        actions.appendChild(delBtn);
        band.appendChild(actions);
      }

      overlay.appendChild(band);
    });

    var empty = state.rows.every(function (r) { return r.elements.length === 0; });
    document.getElementById('empty-hint').hidden = !empty;
    renderRowStrip(state);
  }

  /** 移动端行管理条：每行一枚芯片（▲▼ 调序 / 存预设 / 删行），悬于牌面下方零遮挡 */
  function renderRowStrip(state) {
    var strip = document.getElementById('row-strip');
    if (!strip) return;
    strip.innerHTML = '';
    if (!(App.isMobileView && App.isMobileView())) return;
    state.rows.forEach(function (row, i) {
      var chip = h('div', { class: 'row-strip-chip' });
      chip.appendChild(h('span', { class: 'rs-label', text: '行 ' + (i + 1) }));
      if (state.rows.length > 1) {
        var up = h('button', { class: 'rs-btn', text: '▲', title: '上移此行' });
        up.disabled = i === 0;
        up.addEventListener('click', function () { moveRowBy(i, -1); });
        var down = h('button', { class: 'rs-btn', text: '▼', title: '下移此行' });
        down.disabled = i === state.rows.length - 1;
        down.addEventListener('click', function () { moveRowBy(i, 1); });
        chip.appendChild(up);
        chip.appendChild(down);
      }
      var saveBtn = h('button', { class: 'rs-btn rs-wide', text: '⭐ 存预设', title: '将此行保存为预设' });
      saveBtn.addEventListener('click', function () { saveRowAsPreset(i); });
      var delBtn = h('button', {
        class: 'rs-btn rs-danger', text: '✕ 删行',
        title: state.rows.length > 1 ? '删除此行' : '至少保留一行',
      });
      if (state.rows.length <= 1) delBtn.disabled = true;
      delBtn.addEventListener('click', function () { confirmDeleteRow(i); });
      chip.appendChild(saveBtn);
      chip.appendChild(delBtn);
      strip.appendChild(chip);
    });
  }

  function moveRowBy(from, delta) {
    var to = from + delta;
    if (to < 0 || to >= App.state.rows.length || to === from) return;
    App.update(function (st) { return State.moveRow(st, from, to); });
  }

  function hideIndicators() {
    elIndicator.style.display = 'none';
    rowIndicator.style.display = 'none';
    clearRowHighlights();
  }

  function rowBandByIndex(i) {
    return overlay.querySelector('.row-band[data-row-index="' + i + '"]');
  }

  function clearRowHighlights() {
    UI.$$('.row-band', overlay).forEach(function (b) {
      b.classList.remove('drop-ok', 'drop-invalid');
    });
  }

  // ─── 坐标换算 ──────────────────────────────────────────────

  /** 屏幕坐标 → 标识牌坐标 */
  function toSignPoint(ev) {
    var rect = svg.getBoundingClientRect();
    var layout = App.layout;
    if (!layout || rect.width === 0) return null;
    return {
      x: (ev.clientX - rect.left) * layout.width / rect.width,
      y: (ev.clientY - rect.top) * layout.height / rect.height,
    };
  }

  function rowIndexAt(y) {
    var layout = App.layout;
    if (!layout) return -1;
    for (var i = 0; i < layout.rows.length; i++) {
      var r = layout.rows[i];
      if (y >= r.y && y < r.y + r.height) return i;
    }
    return -1;
  }

  /**
   * 指针 x 处的落点：{ gap, indicatorX }。gap 为数组间隙序号（moveElement 语义，含被拖元素）。
   * 固定宽度下元素按「元素对齐」分三条通道：左/中通道的数组序 = 视觉序（自左向右），
   * 贴右通道的数组序与视觉序相反（数组靠前者贴右缘）。
   * 因此按被拖元素自身通道计算通道内间隙，再映射回数组间隙与指示线位置：
   * - 左/中：通道内间隙 = 中点在指针左侧的元素数，指示线在该元素左缘
   * - 贴右：通道内间隙 = 中点在指针右侧的元素数，指示线在该元素右缘
   * draggedWidth（可选）：拖入空通道时用于给出指示线的实际落点（居中通道需按宽度居中）。
   */
  function dropTargetAt(rowIndex, x, align, draggedWidth) {
    var rowLayout = App.layout.rows[rowIndex];
    var slots = rowLayout.elements;
    var row = App.state.rows[rowIndex];
    var fixed = App.state.widthMode === 'fixed';
    var lane = fixed && align === 'right' ? 'right'
      : (fixed && align === 'center' ? 'center' : 'left');
    var laneIdx = [];
    for (var i = 0; i < slots.length; i++) {
      var el = row && row.elements[i];
      var a = fixed && el && el.props ? el.props.elementAlign : 'left';
      if (a !== 'right' && a !== 'center') a = 'left';
      if (a === lane) laneIdx.push(i);
    }
    if (laneIdx.length === 0) {
      // 通道内暂无元素：左/中落在内容起点（居中按元素宽度落在牌面中央），
      // 贴右落在牌面右缘
      if (lane === 'center') {
        return {
          gap: slots.length,
          indicatorX: Math.max(0, (App.layout.width - (draggedWidth || 0)) / 2),
        };
      }
      return { gap: slots.length, indicatorX: lane === 'right' ? App.layout.width : 0 };
    }
    var j = 0, gap, indicatorX;
    if (lane === 'right') {
      while (j < laneIdx.length && slots[laneIdx[j]].x + slots[laneIdx[j]].width / 2 > x) j++;
      // 数组靠前者贴右缘：指针右侧的通道元素数 = 落点之前的数组位置
      gap = j === 0 ? laneIdx[0] : laneIdx[j - 1] + 1;
      indicatorX = j === 0
        ? slots[laneIdx[0]].x + slots[laneIdx[0]].width
        : (j < laneIdx.length ? slots[laneIdx[j]].x + slots[laneIdx[j]].width
                              : slots[laneIdx[laneIdx.length - 1]].x);
    } else {
      while (j < laneIdx.length && slots[laneIdx[j]].x + slots[laneIdx[j]].width / 2 < x) j++;
      gap = j < laneIdx.length ? laneIdx[j] : laneIdx[laneIdx.length - 1] + 1;
      indicatorX = j < laneIdx.length ? slots[laneIdx[j]].x
        : slots[laneIdx[laneIdx.length - 1]].x + slots[laneIdx[laneIdx.length - 1]].width;
    }
    return { gap: gap, indicatorX: indicatorX };
  }

  /** 指针 x 处的落点数组间隙序号（align 缺省按左通道；兼容旧调用） */
  function gapIndexAt(rowIndex, x, align) {
    return dropTargetAt(rowIndex, x, align).gap;
  }

  // ─── 点击选中 ──────────────────────────────────────────────

  function onSvgClick(ev) {
    if (suppressClick) { suppressClick = false; return; }
    var g = ev.target.closest ? ev.target.closest('g.element') : null;
    App.select(g ? g.getAttribute('data-element-id') : null);
  }

  // ─── 键盘：Del 删除选中元素 ────────────────────────────────

  function onKeyDown(ev) {
    if (ev.key !== 'Delete' && ev.key !== 'Backspace') return;
    if (!App.selection.elementId) return;
    // 焦点在输入控件内时不拦截（文本编辑优先）
    var t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
              t.tagName === 'SELECT' || t.isContentEditable)) return;
    // 模态对话框打开时不响应
    if (document.querySelector('.modal-mask')) return;
    ev.preventDefault();
    var id = App.selection.elementId;
    App.update(function (st) { return State.deleteElement(st, id); });
    App.select(null);
  }

  // ─── 元素指针拖拽（行内排序 / 跨行移动）────────────────────

  var elemDrag = null; // {elementId, rowId, pointerId, active, ghost, dx, dy, startX, startY, target}

  function onElementPointerDown(ev) {
    if (ev.button !== 0) return;
    var g = ev.target.closest ? ev.target.closest('g.element') : null;
    if (!g) return; // 空白处按下 → 冒泡为取消选中（click 处理）

    var elementId = g.getAttribute('data-element-id');
    var rowId = g.getAttribute('data-row-id');
    elemDrag = {
      elementId: elementId,
      rowId: rowId,
      pointerId: ev.pointerId, // 会话锁定该指针：其他指针（如捏合第二指）的事件一律忽略
      active: false,
      ghost: null,
      startX: ev.clientX,
      startY: ev.clientY,
      dx: 0, dy: 0,
    };
    document.addEventListener('pointermove', onElementDragMove);
    document.addEventListener('pointerup', onElementDragEnd);
    document.addEventListener('pointercancel', onElementDragEnd);
    if (ev.pointerType === 'mouse') ev.preventDefault();
  }

  function activateElementDrag(ev) {
    var g = svg.querySelector('g.element[data-element-id="' + elemDrag.elementId + '"]');
    if (!g) { elemDrag = null; return; }
    var rect = g.getBoundingClientRect();
    // 元素在标识牌坐标系中的尺寸
    var found = State.findElement(App.state, elemDrag.elementId);
    if (!found) { elemDrag = null; return; }
    var layoutRow = App.layout.rows.find(function (r) { return r.id === elemDrag.rowId; });
    var slot = layoutRow && layoutRow.elements.find(function (s) { return s.id === elemDrag.elementId; });
    if (!slot) { elemDrag = null; return; }

    var viewBoxW = slot.width;
    var viewBoxH = App.state.rowHeight;

    var ghostSvg = document.createElementNS(Core.SVG_NS, 'svg');
    ghostSvg.setAttribute('viewBox', '0 0 ' + viewBoxW + ' ' + viewBoxH);
    ghostSvg.style.width = rect.width + 'px';
    ghostSvg.style.height = rect.height + 'px';
    var clone = g.cloneNode(true);
    clone.removeAttribute('transform');
    clone.removeAttribute('class');
    var hit = clone.querySelector('.hitbox');
    if (hit) hit.remove();
    ghostSvg.appendChild(clone);

    var ghost = h('div', { class: 'drag-ghost' });
    ghost.appendChild(ghostSvg);
    document.body.appendChild(ghost);

    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';

    g.classList.add('dragging');
    elemDrag.ghost = ghost;
    elemDrag.dx = ev.clientX - rect.left;
    elemDrag.dy = ev.clientY - rect.top;
    elemDrag.active = true;
    document.body.classList.add('drag-in-progress');
  }

  function onElementDragMove(ev) {
    if (!elemDrag || ev.pointerId !== elemDrag.pointerId) return;
    if (!elemDrag.active) {
      if (Math.abs(ev.clientX - elemDrag.startX) + Math.abs(ev.clientY - elemDrag.startY) < 5) return;
      activateElementDrag(ev);
      if (!elemDrag) return;
    }
    elemDrag.ghost.style.left = (ev.clientX - elemDrag.dx) + 'px';
    elemDrag.ghost.style.top = (ev.clientY - elemDrag.dy) + 'px';

    var pt = toSignPoint(ev);
    clearRowHighlights();
    if (!pt) return;
    var ri = rowIndexAt(pt.y);
    if (ri === -1) { elIndicator.style.display = 'none'; return; }
    var rowId = App.state.rows[ri].id;
    // 不能把元素放进…（任何行都可以，包括源行）
    var dragFound = State.findElement(App.state, elemDrag.elementId);
    var dragAlign = dragFound ? dragFound.element.props.elementAlign : null;
    // 拖入空通道时指示线需按被拖元素宽度定位（居中通道）
    var dragWidth = 0;
    App.layout.rows.forEach(function (r) {
      r.elements.forEach(function (s) {
        if (s.id === elemDrag.elementId) dragWidth = s.width;
      });
    });
    var target = dropTargetAt(ri, pt.x, dragAlign, dragWidth);
    showElementIndicator(ri, target.indicatorX);
    rowBandByIndex(ri).classList.add('drop-ok');
    elemDrag.target = { rowId: rowId, gap: target.gap };
  }

  function showElementIndicator(rowIndex, xUnits) {
    var layout = App.layout;
    var rl = layout.rows[rowIndex];
    elIndicator.style.display = 'block';
    elIndicator.style.left = (xUnits / layout.width * 100) + '%';
    elIndicator.style.top = (rl.y / layout.height * 100) + '%';
    elIndicator.style.height = (rl.height / layout.height * 100) + '%';
  }

  function onElementDragEnd(ev) {
    if (!elemDrag || ev.pointerId !== elemDrag.pointerId) return;
    detachElementDragListeners();
    var session = elemDrag;
    elemDrag = null;
    document.body.classList.remove('drag-in-progress');

    if (session.ghost) session.ghost.remove();
    var g = svg.querySelector('g.element[data-element-id="' + session.elementId + '"]');
    if (g) g.classList.remove('dragging');
    hideIndicators();

    if (!session.active) return; // 未构成拖拽 → 交给 click 处理选中
    suppressClick = true;
    // click 事件在 pointerup 同一任务内同步派发，先于本超时；
    // 若落点与按下点不同元素导致浏览器不产生 click，标志立即过期，
    // 避免残留吞掉用户下一次点击选中。
    setTimeout(function () { suppressClick = false; }, 0);

    if (session.target) {
      App.update(function (st) {
        return State.moveElement(st, session.elementId, session.target.rowId, session.target.gap);
      });
    }
  }

  function detachElementDragListeners() {
    document.removeEventListener('pointermove', onElementDragMove);
    document.removeEventListener('pointerup', onElementDragEnd);
    document.removeEventListener('pointercancel', onElementDragEnd);
  }

  /** 取消未激活的元素拖拽会话（触屏第二指落下转 pinch 时让位） */
  function cancelElementDrag() {
    if (!elemDrag) return;
    detachElementDragListeners();
    var session = elemDrag;
    elemDrag = null;
    if (session.ghost) session.ghost.remove();
    var g = svg.querySelector('g.element[data-element-id="' + session.elementId + '"]');
    if (g) g.classList.remove('dragging');
    hideIndicators();
    document.body.classList.remove('drag-in-progress');
  }

  // ─── 行拖拽排序 ────────────────────────────────────────────

  var rowDrag = null; // {fromIndex, pointerId, active, boundary}

  function startRowDrag(ev, fromIndex) {
    rowDrag = { fromIndex: fromIndex, pointerId: ev.pointerId, active: true };
    document.addEventListener('pointermove', onRowDragMove);
    document.addEventListener('pointerup', onRowDragEnd);
    document.addEventListener('pointercancel', onRowDragEnd);
  }

  function onRowDragMove(ev) {
    if (!rowDrag || ev.pointerId !== rowDrag.pointerId) return;
    var pt = toSignPoint(ev);
    if (!pt) return;
    var layout = App.layout;
    var n = layout.rows.length;
    // 指针所在行 → 插入边界（该行之前），下半则在其后
    var ri = rowIndexAt(pt.y);
    if (ri === -1) {
      ri = pt.y < 0 ? 0 : n - 1;
    }
    var boundary = pt.y > layout.rows[ri].y + layout.rows[ri].height / 2 ? ri + 1 : ri;
    boundary = Core.clamp(boundary, 0, n);
    rowDrag.boundary = boundary;
    rowIndicator.style.display = 'block';
    var y = boundary < n ? layout.rows[boundary].y : layout.height;
    rowIndicator.style.top = (y / layout.height * 100) + '%';
  }

  function onRowDragEnd(ev) {
    if (!rowDrag || ev.pointerId !== rowDrag.pointerId) return;
    detachRowDragListeners();
    var session = rowDrag;
    rowDrag = null;
    rowIndicator.style.display = 'none';
    if (session.boundary === undefined) return;
    var from = session.fromIndex;
    var to = session.boundary > from ? session.boundary - 1 : session.boundary;
    if (to !== from) {
      App.update(function (st) { return State.moveRow(st, from, to); });
    }
  }

  function detachRowDragListeners() {
    document.removeEventListener('pointermove', onRowDragMove);
    document.removeEventListener('pointerup', onRowDragEnd);
    document.removeEventListener('pointercancel', onRowDragEnd);
  }

  /** 取消尚未移动过的行拖拽会话（触屏第二指落下转 pinch 时让位） */
  function cancelRowDrag() {
    if (!rowDrag) return;
    detachRowDragListeners();
    rowDrag = null;
    rowIndicator.style.display = 'none';
  }

  // ─── 左栏卡片 / 预设 拖放接收（HTML5 DnD）─────────────────

  function readDragKind(ev) {
    var types = ev.dataTransfer.types;
    if (Array.prototype.indexOf.call(types, MIME_PRESET) !== -1) return 'preset';
    if (Array.prototype.indexOf.call(types, MIME_NEW) !== -1) return 'new';
    return null;
  }

  function readDragPayload(ev, kind) {
    var mime = kind === 'preset' ? MIME_PRESET : MIME_NEW;
    var raw = ev.dataTransfer.getData(mime) || ev.dataTransfer.getData('text/plain');
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function onPaletteDragOver(ev) {
    var kind = readDragKind(ev);
    if (!kind) return; // 非本应用拖拽，不拦截
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';

    var pt = toSignPoint(ev);
    clearRowHighlights();
    elIndicator.style.display = 'none';
    if (!pt) return;
    var ri = rowIndexAt(pt.y);
    if (ri === -1) return;
    var band = rowBandByIndex(ri);
    var row = App.state.rows[ri];

    if (kind === 'new') {
      band.classList.add('drop-ok');
      // 新元素来自左栏默认属性（elementAlign: left），按左通道计算落点
      var t = dropTargetAt(ri, pt.x, 'left');
      showElementIndicator(ri, t.indicatorX);
      paletteDropTarget = { kind: kind, rowIndex: ri, gap: t.gap };
    } else {
      // 预设仅可放入空行
      if (row.elements.length === 0) {
        band.classList.add('drop-ok');
        paletteDropTarget = { kind: kind, rowIndex: ri };
      } else {
        band.classList.add('drop-invalid');
        paletteDropTarget = null;
      }
    }
  }

  var paletteDropTarget = null;

  function onPaletteDragLeave(ev) {
    if (!overlay.contains(ev.relatedTarget) && ev.relatedTarget !== overlay) {
      clearRowHighlights();
      elIndicator.style.display = 'none';
      paletteDropTarget = null;
    }
  }

  function onPaletteDrop(ev) {
    ev.preventDefault();
    var kind = readDragKind(ev);
    clearRowHighlights();
    elIndicator.style.display = 'none';
    if (!kind || !paletteDropTarget) return;
    var payload = readDragPayload(ev, kind);
    var target = paletteDropTarget;
    paletteDropTarget = null;
    if (!payload) return;

    if (target.kind === 'new' && payload.type) {
      App.update(function (st) {
        var rowId = st.rows[target.rowIndex].id;
        return State.addElement(st, rowId, State.createElement(payload.type, payload.props), target.gap);
      });
    } else if (target.kind === 'preset' && payload.id) {
      var row = App.state.rows[target.rowIndex];
      if (row.elements.length !== 0) {
        SignUI.toast('预设只能放入空行', 'error');
        return;
      }
      var elements = SignPresets.materialize(payload.id);
      if (!elements || elements.length === 0) {
        SignUI.toast('预设内容为空', 'error');
        return;
      }
      App.update(function (st) {
        var rows = st.rows.map(function (r, i) {
          return i === target.rowIndex ? Object.assign({}, r, { elements: elements }) : r;
        });
        return Object.assign({}, st, { rows: rows });
      });
      SignUI.toast('已应用预设', 'success');
    }
  }

  // ─── 触屏画布手势：pinch 缩放 / 单指平移 / 双击复位 ────────
  // 仅移动布局（≤768px；CSS 已对 #canvas-scroll 设 touch-action:none，原生滚动
  // 由本段接管）且 pointerType === 'touch' 时生效——桌面鼠标与宽视口触屏零变化。
  // 冲突规则：元素/行拖拽会话锁定自己的 pointerId；已激活的会话无视第二指，
  // 未激活（未过 5px 阈值/未移动）的会话在第二指落下时取消并转入 pinch。

  var ZOOM_MIN = 0.5, ZOOM_MAX = 4;
  var TAP_MS = 300, TAP_SLOP = 30, PAN_SLOP = 10;

  var gesture = {
    pointers: {},  // pointerId → {x, y}（画布上跟踪的触点）
    count: 0,
    pan: null,     // {x, y, scrollLeft, scrollTop}
    panMoved: false,
    pinch: null,   // {ids, dist, zoom}
    lastTap: null, // {x, y, ts}
  };

  function hitInteractive(t) {
    if (!t || !t.closest) return false;
    return !!(t.closest('g.element') || t.closest('.row-handle') ||
      t.closest('.row-actions') || t.closest('#add-row-btn'));
  }

  function gestureDragActive() {
    if (elemDrag && elemDrag.active) return true;
    if (rowDrag && rowDrag.boundary !== undefined) return true;
    return false;
  }

  function onGesturePointerDown(ev) {
    if (!App.isMobileView || !App.isMobileView() || ev.pointerType !== 'touch') return;
    gesture.pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    gesture.count++;

    if (gesture.count === 1) {
      gesture.pan = null; gesture.pinch = null; gesture.panMoved = false;
      // 首指落在空白处（非元素/手柄/按钮）且无拖拽会话 → 预备平移
      if (!hitInteractive(ev.target) && !elemDrag && !rowDrag) {
        gesture.pan = {
          x: ev.clientX, y: ev.clientY,
          scrollLeft: canvasScroll.scrollLeft, scrollTop: canvasScroll.scrollTop,
        };
        captureGesturePointer(ev.pointerId);
      }
    } else if (gesture.count === 2) {
      // 第二指落下：未激活的拖拽会话让位
      if (elemDrag && !elemDrag.active) cancelElementDrag();
      if (rowDrag && rowDrag.boundary === undefined) cancelRowDrag();
      gesture.pan = null;
      if (!gestureDragActive()) {
        var ids = Object.keys(gesture.pointers);
        var a = gesture.pointers[ids[0]], b = gesture.pointers[ids[1]];
        gesture.pinch = {
          ids: [Number(ids[0]), Number(ids[1])],
          dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          zoom: App.canvasZoom,
        };
        ids.forEach(function (id) { captureGesturePointer(Number(id)); });
      }
    }
    // ≥3 指：维持现有手势不变
  }

  /** 显式捕获到滚动容器：即使中途 DOM 重建，事件也稳定冒泡进手势层 */
  function captureGesturePointer(id) {
    try { canvasScroll.setPointerCapture(id); } catch (e) { /* 合成事件/无活动指针时忽略 */ }
  }

  function onGesturePointerMove(ev) {
    if (!App.isMobileView || !App.isMobileView() || ev.pointerType !== 'touch') return;
    var p = gesture.pointers[ev.pointerId];
    if (!p) return; // 未跟踪的触点（如拖拽会话自己的指针）
    p.x = ev.clientX; p.y = ev.clientY;

    if (gesture.pinch) {
      var a = gesture.pointers[gesture.pinch.ids[0]];
      var b = gesture.pointers[gesture.pinch.ids[1]];
      if (!a || !b) return;
      var d = Math.hypot(a.x - b.x, a.y - b.y);
      // 锚定两指中点：缩放前后该内容点保持在指尖下
      applyCanvasZoom(gesture.pinch.zoom * d / gesture.pinch.dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (gesture.pan && gesture.count === 1) {
      gesture.panMoved = gesture.panMoved ||
        Math.abs(ev.clientX - gesture.pan.x) + Math.abs(ev.clientY - gesture.pan.y) > PAN_SLOP;
      canvasScroll.scrollLeft = gesture.pan.scrollLeft - (ev.clientX - gesture.pan.x);
      canvasScroll.scrollTop = gesture.pan.scrollTop - (ev.clientY - gesture.pan.y);
    }
  }

  function onGesturePointerUp(ev) {
    if (!App.isMobileView || !App.isMobileView() || ev.pointerType !== 'touch') return;
    if (!(ev.pointerId in gesture.pointers)) return;
    var wasTap = !!gesture.pan && !gesture.panMoved && !gestureDragActive();
    var tapX = gesture.pan ? gesture.pan.x : 0, tapY = gesture.pan ? gesture.pan.y : 0;
    delete gesture.pointers[ev.pointerId];
    gesture.count--;

    if (gesture.count <= 0) {
      gesture.count = 0;
      gesture.pan = null;
      gesture.pinch = null;
      if (wasTap) {
        // 双击复位：空白处两次轻点 <300ms 且位移 <30px
        var last = gesture.lastTap;
        gesture.lastTap = null;
        if (last && Date.now() - last.ts < TAP_MS &&
            Math.abs(tapX - last.x) < TAP_SLOP && Math.abs(tapY - last.y) < TAP_SLOP) {
          setCanvasZoom(1);
        } else {
          gesture.lastTap = { x: tapX, y: tapY, ts: Date.now() };
        }
      }
    } else if (gesture.count === 1) {
      // pinch 中一指抬起：手势结束（余指需重新按下才能平移，避免跳变）
      gesture.pinch = null;
      gesture.pan = null;
    }
  }

  function onGesturePointerCancel(ev) {
    if (!App.isMobileView || !App.isMobileView() || ev.pointerType !== 'touch') return;
    if (!(ev.pointerId in gesture.pointers)) return;
    delete gesture.pointers[ev.pointerId];
    gesture.count = Math.max(0, gesture.count - 1);
    if (gesture.count === 0) {
      gesture.pan = null;
      gesture.pinch = null;
      gesture.lastTap = null;
    } else if (gesture.count === 1) {
      gesture.pinch = null;
      gesture.pan = null;
    }
  }

  /** 应用画布缩放并锚定 (anchorX, anchorY)：该屏幕点下的内容在缩放后不动 */
  function applyCanvasZoom(zoom, anchorX, anchorY) {
    zoom = Core.clamp(zoom, ZOOM_MIN, ZOOM_MAX);
    var rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    var ax = (anchorX - rect.left) / rect.width;
    var ay = (anchorY - rect.top) / rect.height;
    App.canvasZoom = zoom;
    App.fitSignDisplay();
    updateZoomBadge();
    var rect2 = svg.getBoundingClientRect();
    canvasScroll.scrollLeft += (rect2.left + ax * rect2.width) - anchorX;
    canvasScroll.scrollTop += (rect2.top + ay * rect2.height) - anchorY;
  }

  function setCanvasZoom(zoom) {
    App.canvasZoom = Core.clamp(zoom, ZOOM_MIN, ZOOM_MAX);
    App.fitSignDisplay();
    updateZoomBadge();
  }

  function updateZoomBadge() {
    if (!zoomBadge) return;
    zoomBadge.textContent = Math.round(App.canvasZoom * 100) + '%';
  }

  // ─── 行管理动作 ────────────────────────────────────────────

  function confirmDeleteRow(index) {
    var rowId = App.state.rows[index].id;
    if (App.state.rows[index].elements.length === 0) {
      // 空行无内容可丢，直接删除免去确认
      App.update(function (st) { return State.deleteRow(st, rowId); });
      SignUI.toast('已删除空行');
      return;
    }
    SignUI.confirmDialog('确定要删除此行吗？行内 ' + App.state.rows[index].elements.length + ' 个元素将一并删除。', '删除行', '删除').then(function (ok) {
      if (!ok) return;
      // 确认回调时行序可能已变，按 id 删而非按下标
      App.update(function (st) { return State.deleteRow(st, rowId); });
      SignUI.toast('行已删除');
    });
  }

  function saveRowAsPreset(index) {
    var row = App.state.rows[index];
    if (row.elements.length === 0) {
      SignUI.toast('空行不能保存为预设', 'error');
      return;
    }
    SignUI.promptDialog('为这一行元素起个名字：', '保存为预设', '', '如：站台方向牌').then(function (name) {
      if (name === null) return;
      if (!name) { SignUI.toast('预设名称不能为空', 'error'); return; }
      SignPresets.save(name, row.elements);
      SignUI.toast('预设「' + name + '」已保存', 'success');
    });
  }

  global.SignInteract = {
    init: init,
    renderOverlay: renderOverlay,
    toSignPoint: toSignPoint,
    rowIndexAt: rowIndexAt,
    gapIndexAt: gapIndexAt,
    setCanvasZoom: setCanvasZoom,
    MIME_NEW: MIME_NEW,
    MIME_PRESET: MIME_PRESET,
  };
})(typeof window !== 'undefined' ? window : globalThis);
