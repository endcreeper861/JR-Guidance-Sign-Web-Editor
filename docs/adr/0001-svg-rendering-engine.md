# SVG 作为渲染引擎

原 `sign_jr.py` 使用 Pillow 进行位图渲染。Web App 中选用浏览器端 SVG 替代——编辑区即为 SVG 文档，所见即所得。导出时 SVG 可直接序列化为文件，PNG 通过 Canvas API 光栅化。

## 备选方案

**Canvas（2D Context）**：位图渲染，与 Pillow 路径最接近。被否决原因：(a) 点击选中元素需自行实现 hit-test；(b) 字体子像素渲染质量不如 SVG；(c) 导出 SVG 需额外生成矢量路径，增加维护负担。

**纯 DOM + CSS**：用 `<div>` 等 HTML 元素拼凑导向标识。被否决原因：(a) 箭头等复杂形状难以用 CSS 精确表达；(b) 布局对齐依赖 CSS flexbox/grid，导出 SVG 困难；(c) 与最终导出产物（SVG）不是同一种表示，存在"编辑效果 ≠ 导出效果"的偏差。

**SVG**：选中原因：(a) 导向标识元素本质是矢量图形（多边形、矩形、文本），SVG 是其最自然表达；(b) 每个元素是独立 DOM 节点，天然支持点击选中、拖放、属性修改；(c) 编辑区看到的 SVG 就是最终导出产物，零偏差；(d) 导出 SVG 仅需 `outerHTML`，导出 PNG 通过 `drawImage` + `toBlob` 单次转换。
