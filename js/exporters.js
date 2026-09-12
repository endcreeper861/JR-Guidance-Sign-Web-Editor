/**
 * exporters.js — SVG / PNG 导出（issue 06）
 *
 * 导出的文件内嵌 @font-face（base64 数据 URI，懒加载 fonts-data.js），
 * 保证导出产物在任意环境（Illustrator / 其他浏览器 / 图片查看器）视觉一致。
 * PNG 通过 SVG → Image → Canvas 光栅化为标识牌实际像素尺寸。
 */
(function (global) {
  'use strict';

  var Core = global.SignCore;
  var Render = global.SignRender;
  var Storage = global.SignStorage;

  var FONT_FILES = {
    zh400: 'SourceHanSansSC-Regular.woff2',
    zh700: 'SourceHanSansSC-Bold.woff2',
    en400: 'Helvetica-Regular.ttf',
    en700: 'Helvetica-Bold.ttf',
    num400: 'Frutiger-Regular.ttf',
    num700: 'Frutiger-Bold.ttf',
    cond400: 'FrutigerCondensed-Regular.ttf',
    cond700: 'FrutigerCondensed-Bold.ttf',
  };

  // ─── 字体内嵌数据（懒加载）─────────────────────────────────

  var fontDataPromise = null;

  function ensureFontData() {
    if (fontDataPromise) return fontDataPromise;
    fontDataPromise = new Promise(function (resolve, reject) {
      if (global.SIGN_FONT_EMBED) { resolve(global.SIGN_FONT_EMBED); return; }
      var s = document.createElement('script');
      s.src = 'fonts-data.js';
      s.onload = function () {
        if (global.SIGN_FONT_EMBED) { resolve(global.SIGN_FONT_EMBED); return; }
        fontDataPromise = null; // 允许下次导出重试，而不是永久缓存失败
        reject(new Error('字体内嵌数据加载失败'));
      };
      s.onerror = function () {
        fontDataPromise = null; // 允许下次导出重试，而不是永久缓存失败
        reject(new Error('fonts-data.js 加载失败'));
      };
      document.head.appendChild(s);
    });
    return fontDataPromise;
  }

  /** 扫描标识牌，确定需要内嵌的字体面 */
  function collectUsedFonts(sign) {
    var used = {};
    function anyZh() { used.zh400 = true; }
    function anyEn() { used.en400 = true; }
    function anyNum() { used.num400 = true; }
    sign.rows.forEach(function (row) {
      row.elements.forEach(function (el) {
        var p = el.props;
        switch (el.type) {
          case 'bilingual-text':
            if (p.textZh) anyZh();
            if (p.textEn) anyEn();
            if (p.bold) {
              if (p.textZh) used.zh700 = true;
              if (p.textEn) used.en700 = true;
            }
            break;
          case 'big-number':
            if (p.text) anyNum();
            break;
          case 'number-line':
            anyZh(); anyEn(); anyNum();
            break;
          case 'text-line':
            anyZh();                      // 大字 + 「线」标签恒用中文
            if (p.textEn) anyEn();
            break;
          case 'entrance':
          case 'exit':
            if (p.code) anyNum();
            anyZh(); anyEn();
            break;
        }
      });
    });
    return used;
  }

  function buildFontCSS(used, embedData) {
    var rules = [];
    var faces = {
      zh400: ["'Source Han Sans SC'", 400, 'woff2'],
      zh700: ["'Source Han Sans SC'", 700, 'woff2'],
      en400: ["Helvetica", 400, 'truetype'],
      en700: ["Helvetica", 700, 'truetype'],
      num400: ["Frutiger", 400, 'truetype'],
      num700: ["Frutiger", 700, 'truetype'],
      cond400: ["'Frutiger Condensed'", 400, 'truetype'],
      cond700: ["'Frutiger Condensed'", 700, 'truetype'],
    };
    Object.keys(used).forEach(function (key) {
      if (!used[key]) return;
      var file = FONT_FILES[key];
      var data = embedData[file];
      if (!data) return;
      var face = faces[key];
      rules.push(
        "@font-face{font-family:" + face[0] + ";src:url(" + data + ") format('" +
        face[2] + "');font-weight:" + face[1] + ";font-style:normal}"
      );
    });
    return rules.join('\n');
  }

  // ─── 导出 SVG ──────────────────────────────────────────────

  /** 生成自包含 SVG 字符串（内嵌字体） */
  function buildExportSVGString(sign, measure, embedData) {
    var layout = Render.layoutSign(sign, measure);
    var svg = document.createElementNS(Core.SVG_NS, 'svg');
    Render.renderSignInto(svg, sign, measure, { clean: true });
    svg.setAttribute('width', layout.width);
    svg.setAttribute('height', layout.height);
    var css = buildFontCSS(collectUsedFonts(sign), embedData);
    if (css) {
      var style = document.createElementNS(Core.SVG_NS, 'style');
      style.textContent = css;
      svg.insertBefore(style, svg.firstChild);
    }
    var xml = new XMLSerializer().serializeToString(svg);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + xml;
  }

  function exportSVGFile(sign, measure) {
    return ensureFontData().then(function (embedData) {
      var str = buildExportSVGString(sign, measure, embedData);
      var blob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' });
      Storage.download(blob, 'sign-' + Storage.timestamp() + '.svg');
      SignUI.toast('SVG 已导出（内嵌字体）', 'success');
    }, function (err) {
      SignUI.toast(err.message || '导出失败', 'error');
    });
  }

  // ─── 导出 PNG ──────────────────────────────────────────────

  function exportPNGFile(sign, measure) {
    return ensureFontData().then(function (embedData) {
      var layout = Render.layoutSign(sign, measure);
      var str = buildExportSVGString(sign, measure, embedData);
      var url = URL.createObjectURL(new Blob([str], { type: 'image/svg+xml;charset=utf-8' }));
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          try {
            var canvas = document.createElement('canvas');
            canvas.width = layout.width;
            canvas.height = layout.height;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, layout.width, layout.height);
            canvas.toBlob(function (blob) {
              URL.revokeObjectURL(url);
              if (!blob) { reject(new Error('PNG 编码失败')); return; }
              Storage.download(blob, 'sign-' + Storage.timestamp() + '.png');
              resolve(layout.width + '×' + layout.height);
            }, 'image/png');
          } catch (e) {
            URL.revokeObjectURL(url);
            reject(e);
          }
        };
        img.onerror = function () {
          URL.revokeObjectURL(url);
          reject(new Error('SVG 光栅化失败'));
        };
        img.src = url;
      });
    }).then(function (dims) {
      SignUI.toast('PNG 已导出（' + dims + ' px）', 'success');
    }, function (err) {
      SignUI.toast(err.message || '导出失败', 'error');
    });
  }

  global.SignExporters = {
    ensureFontData: ensureFontData,
    collectUsedFonts: collectUsedFonts,
    buildFontCSS: buildFontCSS,
    buildExportSVGString: buildExportSVGString,
    exportSVGFile: exportSVGFile,
    exportPNGFile: exportPNGFile,
  };
})(typeof window !== 'undefined' ? window : globalThis);
