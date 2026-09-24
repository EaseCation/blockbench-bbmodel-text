# BBModel Text Component v0.2.2

为 Blockbench 5.2.1+ 的 Generic Model / `.bbmodel` 创建可编辑文字。新文字始终使用普通零厚度 Cube 和内嵌 PNG；没有安装插件，也能查看、截图和保存成品。

## 安装与协作

通过「文件 → 插件 → 从文件加载」选择 `dist/bbmodel-text-component.js`。

插件可以独立使用。与支持 **Content API 1** 的 [UI Studio](https://github.com/EaseCation/blockbench-ui-studio)同时安装时，文字使用 UI Studio 的 Group＋内容 Cube，并参与 Image 嵌套、Frame / Stack、百分比尺寸、Fill / Hug、视口拖放和统一撤销。两种加载顺序均支持。

建议配套 UI Studio 0.8.3 或更新版本，以包含复杂项目的编辑性能修复。两个插件分别构建、加载；未提供 Content API 1 的旧版 UI Studio 只能使用独立文字功能。

## 使用

- 大纲工具栏「添加文字」创建 `Text`。在 MC UI 项目中默认加入当前 Image / Frame。
- 原生「文字」标签提供内容、字体、字号比例、颜色、行高、字距、对齐、尺寸预设和栅格密度；位置、旋转沿用原生工具，UI 定位和宽高沿用 UI Studio。
- 双击实际命中的文字，或选择「编辑文字」，打开场景实时预览的编辑器。确认生成一次 Undo；取消、Escape、模式或项目切换恢复编辑前的参数、贴图和布局。
- 支持中文输入法组合输入；字体是否包含中文等字形取决于所选字体，可导入 TTF / OTF。浏览器对缺失字形的系统回退在不同系统上可能不同，成品 PNG 始终保存最终显示结果。
- **自动尺寸**：自然宽度和高度；**自动高度**：固定 / 百分比 / Fill 宽度换行，高度随文本增长；**固定文本框**：在本元素的贴图边界内裁掉溢出内容，不裁切其子元素。
- 默认拖动尺寸为**调整文本框**，不改字号；显式**缩放内容**固定排版参考尺寸、贴图和 UV，仅调整显示尺寸。切回调整文本框后按当前边界排版。
- 栅格密度有 1× / 2× / 4×，默认 4×，与显示尺寸分离。父容器变化会重新计算文字高度及 Stack 排列；相机、选择和纯移动不重新生成文字像素。
- 「栅格化文字」转为普通绘画内容，可以撤销；UI Studio 中保留子元素并可恢复原始来源。双击可编辑文字不会误进入 Paint。
- 「导入 TTF / OTF 字体」将字体嵌入项目，并加入本机字体库。选用本机库字体时也会嵌入项目，项目内按字体内容去重。

## 文件与保护

每个文字 Cube 的 `bb_text` Property 保存文本、排版和缩放参数。`unhandled_root_fields.bb_text` 保存共享字体及按 Cube UUID 索引的恢复副本。无插件另存会丢失未注册的 Cube 字段，但项目恢复副本允许重新安装后恢复文字编辑；不复活已删除对象。

UI Studio 文档只保存内容提供者标识、成品来源及逻辑尺寸。参数以 Cube 为主，运行时草稿不会作为第二套权威参数写入 UI 文档。原生剪贴板使用临时资源字段携带字体和像素，保存 `.bbmodel` 时剥离该字段。

独立修改成品像素、UV 或载体后暂停自动重建，保留现场。「按文字重新生成」显式恢复规则；「栅格化文字」/ UI Studio 的「采用当前结果」保留现有成品用于绘画。缺少文字插件时，UI Studio 可以移动、排列及缩放保存的成品，不能重新排版。

旧 `bb_text` 节点仅保留读取适配。使用「编辑 → 转换旧版文字」把选中旧节点（无选区时为全部旧节点）替换为标准 Cube，一次撤销可恢复旧节点。保留名称、层级、显示状态、原点及旋转；三维旋转文字不强行转成 UI 平面。

## 开发与验证

```sh
npm ci
npm run build        # 生成 dist/bbmodel-text-component.js
npm run check        # 类型、单元测试与构建
npm run format:check
MCUI_DIR=../blockbench-ui-studio npm run test:host
```

宿主测试使用隔离的 Blockbench Web 副本，默认位于相邻 UI Studio 仓库 `.cache/blockbench`；用 `BLOCKBENCH_HOST_DIR` 指定其他副本。`MCUI_DIR` 指定 UI Studio 仓库以读取其构建产物。文字测试独占 `127.0.0.1:4181`，与 UI Studio 的测试端口分离。先构建两个插件再运行联动测试。

默认字体来自 IdreesInc/Minecraft-Font，遵循 OFL；参见 `THIRD_PARTY_LICENSES.md`。插件遵循 MIT License。

文字插件可以独立运行，不要求安装 UI Studio。宿主回归可用 `BLOCKBENCH_HOST_DIR` 指定独立的 Blockbench Web 构建；缺少可选 UI Studio 构建时，仅相关集成用例跳过，独立文字与普通建模用例仍可运行。
