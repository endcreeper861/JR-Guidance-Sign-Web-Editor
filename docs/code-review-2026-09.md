# 代码审阅记录 — 2026-09

对全仓库的一次系统性代码审阅（`js/` 全部模块、`index.html`、三套测试、生成脚本），目标是找出**易埋 bug 的隐患、可读性差、未来难维护**的代码并当场修复。每项修改都先补了能变红的回归测试（或经三套测试全绿验证）。

问题分级：

- **P1**：会真实崩溃或损坏数据的隐患；
- **P2**：与文档宣称的架构不符 / 重复劳动，长期必致维护问题；
- **P3**：小瑕疵与死代码。

---

## P1-1 反序列化校验缺口：一份手改 JSON 可让整个编辑器崩溃（state.js）

`deserializeSign` 是外部数据（「导入项目 JSON」、localStorage 自动存档）进入渲染层的**唯一闸门**，但 `sanitizeElement` 只校验了 padding / color / backgroundColor / elementAlign / align / icon 六类属性。以下数据从导入路径进来时**直接让整牌渲染崩溃**（`renderSignInto` 抛错，之后每次 `App.update` 都失败，应用变砖直到清掉存档）：

| 属性 | 坏数据示例 | 后果 |
| --- | --- | --- |
| `number-line.lines` | `"12"`（字符串）、`{}` | `numberLineMetrics` 调 `.map` 抛 TypeError |
| `space.widthRatio` | `"x"` → NaN | 宽度 NaN 写进 viewBox，SVG 整体不可见 |
| `space.widthRatio` | 负数 | 行宽为负，布局错乱 |
| `arrow.thicknessRatio` | NaN | `clamp(NaN)` 仍为 NaN，多边形坐标全 NaN |
| 各文本属性 | 数字 / 对象 | 面板 input 显示 `[object Object]`、测量值错乱 |

**修改**（`js/state.js`）：

- 新增 `sanitizeText`（强制字符串，null/undefined 回默认）、`sanitizeNumber`（有限数夹取，否则回默认）、`sanitizeLines`（收敛为 `[{ number: string, color: #RRGGBB }]`，非对象项剔除；空数组合法——面板允许移除全部线路）。
- `sanitizeElement` 按类型补齐：`arrow.direction` 白名单 + `thicknessRatio` 夹 0.05–0.95（与渲染层一致）；`bilingual-text` 文本/布尔/三档 align；`number-line.lines` + `textColor`；`text-line` 文本/`nameSink`/`blockColor`/`textColor`；`entrance`/`exit` 的 `code`；`space.widthRatio` 夹 0–8（与面板一致）。
- **原则**：工厂 + 面板产生的内部状态本来就合法，所有 sanitizer 对合法值是恒等变换——`serialize → deserialize` 往返测试保持通过；它们只负责把垃圾数据收敛回可渲染形状。

## P1-2 重复 id 不去重（state.js）

导入的 JSON 若有重复的元素/行 id，`data-element-id` 查询与选中态会指向歧义节点（`querySelector` 永远命中第一个）。**修改**：`deserializeSign` 内用 `pickUniqueId` 对行与元素分别去重，重复者重新生成 uuid。

## P1-3 死代码 `isHexColorSafe`（state.js，已删除）

原实现只判断 `null | string`，与名字宣称的"hex 校验"不符；且其调用点在 `sanitizeColor(…, null)` 之后，输入永远已是 `null | 合法hex`，判断**恒真**——纯死代码且误导读者以为有校验。已连同调用点一起删除（`sanitizeColor` 本身已保证结果形状）。

## P2-1 draw 函数重复计算 metrics（render.js）

文档宣称"metrics 纯几何 + draw 消费 metrics"，但实现里 `renderElement` 算一遍 metrics 后，每个 draw 函数又**各自重新调用 metrics 函数**：

- 每个元素每次渲染做两遍文本测量（含 canvas `measureText`），全量重渲染是常态（每次属性编辑），白白翻倍;
- 两处调用点意味着未来某处"只改了一边"的空间——恰是双轨设计要防的。

**修改**：draw 函数签名统一为 `(g, el, mt)`，消费 `renderElement` 已算好的 metrics；文件头注释明确"draw 不得再调用 metrics 函数"。行为不变（Node render 测试 + 浏览器 DOM 测试全绿验证）。

## P3 小修复

| 位置 | 问题 | 修改 |
| --- | --- | --- |
| interact.js `onPaletteDragOver` | `dropEffect = kind === 'preset' ? 'copy' : 'copy'` 两个分支同值，死三元 | 直接赋 `'copy'` |
| interact.js `confirmDeleteRow` | 确认回调里按**下标**取行，弹窗期间行序若变会删错行/越界抛错 | 调用时捕获 `rowId`，回调按 id 删 |
| ui.js `select`/`previewPreset` | `renderAll()` 内已调 `SignPanel.syncRightPanel()`，其后又显式调一次，每次选中做两遍面板同步 | 删除冗余调用 |
| storage.js `pickImportFile` | 用户取消文件选择时 Promise 永不结算，隐藏 `<input>` 残留 DOM | 监听 `cancel` 事件一并结算并移除节点 |
| storage.js `writeInstance` | 心跳写 localStorage 无异常保护，存储被禁时每 2s 抛未捕获异常 | try/catch（守卫退化为无心跳，不致命） |
| presets.js `persist` | `setItem` 配额溢出会中断保存流程且异常逃逸到 UI 回调 | try/catch + console.error；失败不触发变更通知，UI 与存储保持一致 |

## 审阅过但决定不改的项（记录以免重复怀疑）

- **`FONT_NUM_CONDENSED` / cond400/700 字面**：数字线路已不再使用窄体（两位数改常规 Frutiger + 墨区排版），字体预载与 `fonts-data.js` 中的窄体面暂成冗余。但字体管线是外部仓库的构建产物，删载入项收益微小、牵涉管线文档，保留待将来真正移除窄体文件时一并处理。
- **`App.update` 不捕获 pureFn 异常**：内部状态经工厂/面板/sanitize 三层保证合法，pureFn 抛错只可能来自编程错误，静默吞掉反而掩盖问题。
- **`LINE_COLORS`/`EXTRA_SWATCHES` 兼容别名**：外部测试在用，core.js 内已有注释说明，保留。
- **JSON `__proto__` 键**：`JSON.parse` 不触发 setter，`Object.assign` 至多改变一个临时对象的原型，不会污染 `Object.prototype`，无实际攻击面。

## 文档同步修正（同批完成）

- `CONTEXT.md` 图标条目：库路径由过时的 `web-app/js/icons.js` / `web-app/gen-icons.mjs` 改为实际路径 `js/icons.js` / `gen-icons.mjs`。
- `README.md`：signmaker-main 源链接原先是不完整的 `https://github.com/`，改为纯文本名称（上游仓库地址未记录，宁缺毋错）；文档表增加本文件条目。
- `docs/development.md`：render.js 一节补充 draw 函数签名与"单次测量"约束；「新增元素类型清单」把 sanitize 校验从"如需"改为**必须**（含 P1-1 的教训）。
- `AGENTS.md`：文档地图增加本文件条目。

## 验证

- `node --test`：70 项全绿（新增 5 项反序列化回归，均先红后绿）。
- `test.html`：真实字体 DOM 断言全绿。
- `e2e.html`：30 个交互场景全绿。
- `index.html` 视觉确认渲染无回归。
