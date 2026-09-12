/**
 * main.js — 启动装配
 *
 * 顺序：实例守卫 → 字体预加载（测量依赖）→ 恢复/新建状态 → 装配 UI → 首帧渲染。
 */
(function (global) {
  'use strict';

  var FONT_TIMEOUT_MS = 30000;   // 字体面加载的兑底放行时限
  var FONT_SLOW_HINT_MS = 8000;  // 超过此时长更新提示文案

  function showLoading(text) {
    var el = document.getElementById('loading-overlay');
    el.hidden = false;
    if (text) document.getElementById('loading-text').textContent = text;
  }

  function hideLoading() {
    document.getElementById('loading-overlay').hidden = true;
  }

  /**
   * 预加载全部字体面（度量依赖，未就绪不进界面）。
   * 超过 FONT_TIMEOUT_MS 仍不齐则带系统回退放行（resolve(false)），
   * 单面失败不算超时（catch 后继续等其余面）。
   */
  function loadFonts() {
    var all = Promise.all(SignCore.FONT_LOAD_SPECS.map(function (s) {
      return document.fonts.load(s.css).catch(function () { /* 单面失败继续 */ });
    })).then(function () { return true; });
    var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(false); }, FONT_TIMEOUT_MS); });
    var slowHint = setTimeout(function () {
      showLoading('字体加载较慢，仍在等待…（可检查网络后刷新）');
    }, FONT_SLOW_HINT_MS);
    return Promise.race([all, timeout]).then(function (ready) {
      clearTimeout(slowHint);
      return ready;
    });
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

    // 画布尺寸变化（窗口缩放、面板收展）时重算编辑区显示尺寸
    if (window.ResizeObserver) {
      new ResizeObserver(function () { App.fitSignDisplay(); })
        .observe(document.getElementById('canvas-wrap'));
    }
    window.addEventListener('resize', function () { App.fitSignDisplay(); });
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
      showLoading('正在加载字体…（首次访问约 6 MB）');
      // 并行预载导出用内嵌字体（fonts-data.js 约 7 MB）：不阻塞进界面，
      // 但通常在用户点导出前已就绪；失败时点导出会重试并有忙碌提示。
      SignExporters.ensureFontData().catch(function () { /* 导出时重试 */ });
      loadFonts().then(function (fontsReady) {
        App.measure = SignCore.createCanvasMeasurer();
        App.state = SignStorage.loadAutosave() || SignState.createSign();
        App.prefs = SignStorage.loadPrefs();

        SignInteract.init();
        wireStaticButtons();
        SignPanel.buildPalette();
        App.renderAll();
        hideLoading();
        if (!fontsReady) {
          SignUI.toast('字体未能完全加载，文字度量可能不准，建议刷新重试', 'error');
        }

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
