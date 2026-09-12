# ADR 0002：移动端支持

- 状态：已接受（2026-09-12）
- 关联：[ADR 0001 SVG 渲染引擎](0001-svg-rendering-engine.md)、[development.md 移动端适配](../development.md)

## 背景

编辑器原本只有桌面三栏布局，移动浏览器上画布被两栏侧板挤压到不可用，触屏无 hover、无 HTML5 拖放、 pinch 会被浏览器吃成页面缩放，且移动端切后台不触发 `beforeunload`，防抖中的自动存档可能丢失。

## 决策

### 1. 断点与布局形态

`≤768px` 切换为纵向三段式：顶部横向滚动的元素选择器（分类 chip 行 + 当前分类横向卡片条）→ 中间画布 → 底部属性+导出带（约 40vh、内部滚动、可折叠成 48px 细条）。`>768px` 桌面三栏**原样保留、行为零变化**。判定用 `App.isMobileView()`（`matchMedia('(max-width: 768px)')`，ui.js），与 style.css 媒体查询、main.js 断点监听共用同一数值。

替代方案（响应式压缩三栏、独立移动页面）被否：前者在窄屏塞不下三块功能；后者违背零依赖单页架构。

### 2. Pointer Events 统一输入层

拖拽（元素/行）从 mouse 事件迁到 Pointer Events，一套代码服务鼠标 + 触屏 + 笔；会话记录并锁定 `pointerId`（`pointermove/up/cancel` 校验一致才处理，`pointercancel` 视作结束）。`click` 处理器全部保留（选中逻辑不变）。HTML5 DnD 保留给桌面；**移动端在卡片上彻底禁用**（`draggable="false"` + dragstart `preventDefault`）——触屏长按会唤起浏览器原生拖拽会话（卡片被置灰、会话收不了场表现为页面卡死），点击添加是移动端唯一添加途径（`buildItemCard` 工厂两端共用），且**仅移动端添加后自动选中新元素**（`createElementForItem` 在 `App.update` 前创建以捕获 id），驱动底部带切到该元素表单并自动展开。可行性依据：拖拽会话只消费 `clientX/Y`，算法与事件类型无关。

鼠标 `preventDefault` 保持原行为；触屏不调（防个别浏览器吞 click），滚动抑制交给 `touch-action`（`hitbox`/`.row-handle` 为 `none`，卡片为 `manipulation`）。

### 3. hover 替代与行控件外置

`@media (hover: none)`（无悬停设备，独立于断点）下行手柄/行按钮常显——该规则实际服务于**宽视口触屏设备**（平板的桌面布局）。**≤768px 移动布局则将行控件整体移出牌面**：行带内不渲染手柄/按钮，改为牌面下方的 `#row-strip` 行管理条，每行一枚芯片（▲▼ 按钮调序替代拖拽手柄、⭐ 存预设、✕ 删行，触控目标 ≥44px）——行内悬浮控件会与牌面元素互相叠加，外置条零遮挡。移动 media 块置于 hover:none 块之后，以 `display:none` 压制行带内控件。预设卡删除按钮维持 hover 语义——预览面板已有删除按钮兜底。

### 4. 画布手势与缩放

`App.canvasZoom`（会话态，不持久化）乘进 `fitSignDisplay` 的适配宽度；`#canvas-scroll` 在移动媒体块内 `touch-action: none`，原生滚动交由 interact.js 手势层接管：单指空白处拖动=平移（调 `scrollLeft/Top`）、双指=pinch（按指间距离比缩放 0.5x–4x，锚定两指中点：缩放前后同步调滚动使该内容点不动）、空白处双击（<300ms、位移<30px）复位 1x。冲突规则：拖拽会话锁定自己的 `pointerId`；**已激活**的会话无视第二指，**未激活**（未过 5px 阈值）的会话在第二指落下时取消并转入 pinch。画布右下角缩放徽标（仅移动布局显示）实时显示倍率、点按复位。桌面鼠标零变化（手势层只认 `pointerType === 'touch'` 且移动布局），桌面不加滚轮缩放。

### 5. 生命周期与断点切换

自动存档刷盘与多标签心跳释放补 `pagehide` + `visibilitychange(hidden)`（移动端切后台不触发 `beforeunload`），`visible` 时恢复心跳。断点跨越（matchMedia change + resize + `documentElement` ResizeObserver 三路兜底，同一幂等检查）时：重建 palette（结构随断点不同，chip 态为 panel.js 模块态跨重建保留）、复位 `canvasZoom`、清理两端折叠态类（桌面 `collapsed` 与移动 `band-collapsed` 语义不混用）、切换空状态提示文案。

## 后果

- e2e 拖拽模拟全部改派 PointerEvent（`pointer()` 助手），另覆盖缩放管线（S36）、pagehide 刷盘（S37）、移动壳层+手势（S38，通过收窄 iframe 视口驱动）。
- 已知环境限制：部分嵌入式浏览器（如应用内浏览器的 iframe）对视口变化的布局重算/事件派发会被节流推迟，真实设备上视口变化（旋转、窗口调整）总是及时派发；e2e 中补发 `resize` 事件直达断点检查以保持确定性。
- `hover: none` 在带鼠标的桌面机上不命中（媒体特性反映设备输入能力），故桌面行手柄维持悬停显隐。
