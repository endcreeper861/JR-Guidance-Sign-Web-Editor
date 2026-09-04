/**
 * main.js — 启动装配
 *
 * 顺序：实例守卫 → 字体预加载（测量依赖）→ 恢复/新建状态 → 装配 UI → 首帧渲染。
 */
(function (global) {
  'use strict';

  var FONT_TIMEOUT_MS = 5000;

  function showLoading(text) {
    var el = document.getElementById('loading-overlay');
    el.hidden = false;
    if (text) document.getElementById('loading-text').textContent = text;
  }

  function hideLoading() {
    document.getElementById('loading-overlay').hidden = true;
  }

  /** 预加载全部字体面（超时则带系统回退继续） */
  function loadFonts() {
    var specs = SignCore.FONT_LOAD_SPECS.map(function (s) {
      return document.fonts.load(s.css).catch(function () { /* 单面失败继续 */ });
    });
    var timeout = new Promise(function (resolve) { setTimeout(resolve, FONT_TIMEOUT_MS); });
    return Promise.race([Promise.all(specs), timeout]);
  }

  function wireStaticButtons() {
    var left = document.getElementById('left-panel');
    var right = document.getElementById('right-panel');
    var leftExp = document.getElementById('left-expander');
    var rightExp = document.getElementById('right-expander');

    document.getElementById('left-collapse').addEventListener('click', function () {
      left.classList.add('collapsed');
      leftExp.hidden = false;
      App.panels.left = false;
    });
    leftExp.addEventListener('click', function () {
      left.classList.remove('collapsed');
      leftExp.hidden = true;
      App.panels.left = true;
    });
    document.getElementById('right-collapse').addEventListener('click', function () {
      right.classList.add('collapsed');
      rightExp.hidden = false;
      App.panels.right = false;
    });
    rightExp.addEventListener('click', function () {
      right.classList.remove('collapsed');
      rightExp.hidden = true;
      App.panels.right = true;
    });

    document.getElementById('close-element-btn').addEventListener('click', function () {
      if (App.presetPreviewId) App.previewPreset(null);
      else App.select(null);
    });
  }

  /** 关闭页面前立即落盘未防抖的最后一次变更 */
  function flushAutosaveOnExit() {
    window.addEventListener('beforeunload', function () {
      if (App.state) {
        try { localStorage.setItem(SignStorage.AUTOSAVE_KEY, SignState.serializeSign(App.state)); } catch (e) { /* 忽略 */ }
      }
    });
  }

  function showBlockedNotice() {
    document.body.innerHTML = '';
    var div = document.createElement('div');
    div.style.cssText = 'height:100vh;display:flex;align-items:center;justify-content:center;' +
      'flex-direction:column;gap:12px;color:#6b7684;font-size:15px;font-family:system-ui,sans-serif;';
    div.textContent = '已取消启动，以保护另一标签页中的编辑数据。请直接关闭此页面。';
    document.body.appendChild(div);
  }

  function boot() {
    showLoading('正在检查编辑器实例…');

    SignStorage.setupInstanceGuard().then(function (proceed) {
      if (!proceed) {
        hideLoading();
        showBlockedNotice();
        return;
      }
      showLoading('正在加载字体…');
      loadFonts().then(function () {
        App.measure = SignCore.createCanvasMeasurer();
        App.state = SignStorage.loadAutosave() || SignState.createSign();
        App.prefs = SignStorage.loadPrefs();

        SignInteract.init();
        wireStaticButtons();
        SignPanel.buildPalette();
        App.renderAll();
        hideLoading();

        // 字体全部就绪后再刷一帧，避免度量差异
        document.fonts.ready.then(function () { App.renderAll(); });
        flushAutosaveOnExit();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
