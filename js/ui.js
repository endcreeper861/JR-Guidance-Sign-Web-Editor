/**
 * ui.js — 全局应用上下文与 UI 基建（toast / 模态对话框 / DOM 工具）
 *
 * App 是唯一的全局可变上下文：当前状态、选中项、测量器、布局缓存。
 * 所有状态变更通过 App.update(pureFn) 走不可变更新 → 重渲染 → 自动保存。
 */
(function (global) {
  'use strict';

  var App = {
    state: null,                  // SignState（唯一数据源）
    measure: null,                // 文本测量器（fonts 就绪后可用）
    layout: null,                 // 最近一次渲染的布局（SignRender.layoutSign 结果）
    selection: { elementId: null },
    presetPreviewId: null,        // 右栏预设预览模式
    panels: { left: true, right: true },
    // 编辑器偏好（非标识牌数据，localStorage 持久化；main.js 启动时以存档覆盖）
    prefs: { autoLineColor: true, paletteCity: 'shanghai' },

    /** 状态变更入口：pureFn(sign) → 新 sign */
    update: function (pureFn) {
      App.state = pureFn(App.state);
      App.renderAll();
      if (global.SignStorage) SignStorage.scheduleAutosave(App.state);
    },

    /** 全量重渲染：SVG + 覆盖层 + 右栏同步（不动焦点） */
    renderAll: function () {
      if (!App.state || !App.measure) return;
      var svg = document.getElementById('sign-svg');
      App.layout = SignRender.renderSignInto(svg, App.state, App.measure, {
        selectedElementId: App.selection.elementId,
      });
      App.fitSignDisplay();
      if (global.SignInteract) SignInteract.renderOverlay(App.layout, App.state);
      if (global.SignPanel) SignPanel.syncRightPanel();
    },

    /**
     * 编辑区显示尺寸：适配画布宽度，但缩放不超过 100%——
     * 窄标识牌不放大（否则行高会被等比放大得过大），宽标识牌铺满画布。
     * canvas-wrap 尺寸变化（窗口缩放/面板收展）由 ResizeObserver 触发重算（main.js）。
     */
    fitSignDisplay: function () {
      if (!App.layout) return;
      var svg = document.getElementById('sign-svg');
      var wrap = document.getElementById('canvas-wrap');
      if (!svg || !wrap) return;
      var avail = wrap.clientWidth;
      if (avail > 0) svg.style.width = Math.min(avail, App.layout.width) + 'px';
    },

    /** 选中元素（null = 取消选中，回到标识牌设置） */
    select: function (elementId) {
      if (App.selection.elementId === elementId) return;
      App.selection.elementId = elementId;
      if (elementId !== null) App.presetPreviewId = null;
      App.renderAll(); // renderAll 内部已含右栏同步
    },

    /** 进入预设预览模式 */
    previewPreset: function (presetId) {
      App.presetPreviewId = presetId;
      App.selection.elementId = null;
      App.renderAll();
    },
  };
  global.App = App;

  // ─── DOM 工具 ──────────────────────────────────────────────

  function h(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === 'class') e.className = attrs[k];
        else if (k === 'text') e.textContent = attrs[k];
        else if (k === 'style' && typeof attrs[k] === 'object') Object.assign(e.style, attrs[k]);
        else if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
      }
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // ─── Toast ─────────────────────────────────────────────────

  function toast(message, type) {
    var el = h('div', { class: 'toast' + (type ? ' ' + type : ''), text: message });
    document.getElementById('toasts').appendChild(el);
    setTimeout(function () {
      el.classList.add('leaving');
      setTimeout(function () { el.remove(); }, 300);
    }, type === 'error' ? 4200 : 2400);
  }

  // ─── 模态对话框 ────────────────────────────────────────────

  /**
   * 确认对话框 → Promise<boolean>
   * confirmDialog('确定要删除此行吗？', '删除行')
   */
  function confirmDialog(message, title, confirmText) {
    return new Promise(function (resolve) {
      var mask = h('div', { class: 'modal-mask' });
      var modal = h('div', { class: 'modal' }, [
        h('h3', { text: title || '确认操作' }),
        h('div', { class: 'modal-body', text: message }),
        h('div', { class: 'modal-actions' }, [
          h('button', { class: 'btn', text: '取消', 'data-act': 'cancel' }),
          h('button', {
            class: 'btn btn-danger', text: confirmText || '确定', 'data-act': 'ok',
          }),
        ]),
      ]);
      mask.appendChild(modal);
      mask.addEventListener('click', function (ev) {
        var act = ev.target.getAttribute && ev.target.getAttribute('data-act');
        if (act === 'ok') { mask.remove(); resolve(true); }
        else if (act === 'cancel' || ev.target === mask) { mask.remove(); resolve(false); }
      });
      document.getElementById('modal-root').appendChild(mask);
      modal.querySelector('[data-act="ok"]').focus();
    });
  }

  /**
   * 输入对话框 → Promise<string|null>
   * promptDialog('预设名称', '保存为预设', '站台方向牌')
   */
  function promptDialog(message, title, defaultValue, placeholder) {
    return new Promise(function (resolve) {
      var input = h('input', {
        class: 'modal-input', type: 'text', value: defaultValue || '', placeholder: placeholder || '',
      });
      var mask = h('div', { class: 'modal-mask' });
      var modal = h('div', { class: 'modal' }, [
        h('h3', { text: title || '输入' }),
        h('div', { class: 'modal-body', text: message }),
        input,
        h('div', { class: 'modal-actions' }, [
          h('button', { class: 'btn', text: '取消', 'data-act': 'cancel' }),
          h('button', { class: 'btn btn-primary', text: '确定', 'data-act': 'ok' }),
        ]),
      ]);
      mask.appendChild(modal);
      function done(val) { mask.remove(); resolve(val); }
      mask.addEventListener('click', function (ev) {
        var act = ev.target.getAttribute && ev.target.getAttribute('data-act');
        if (act === 'ok') done(input.value.trim() || null);
        else if (act === 'cancel' || ev.target === mask) done(null);
      });
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') done(input.value.trim() || null);
        if (ev.key === 'Escape') done(null);
      });
      document.getElementById('modal-root').appendChild(mask);
      input.focus();
      input.select();
    });
  }

  global.SignUI = {
    h: h,
    $: $,
    $$: $$,
    toast: toast,
    confirmDialog: confirmDialog,
    promptDialog: promptDialog,
  };
})(typeof window !== 'undefined' ? window : globalThis);
