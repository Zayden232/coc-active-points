# tools/ — 本项目的验证工具

这里的脚本是**这个项目自带的测试与巡检工具**，全部不依赖任何私密信息，可以直接在 clone 下来的仓库里跑。

> 部署/运维脚本（`deploy-*.sh`、`ssh.ps1`、`askpass.cmd` 等）**不在这个目录**：
> 它们含服务器地址与口令，留在开发机的私有 `.tool/` 里，不进版本库。
> 文档（`README.md` / `deploy/DEPLOY.md`）里对 `.tool/...` 的引用指的是那些私有脚本。

## 准备

```bash
# 后端依赖（跑服务端测试用）
cd server && npm install

# 前端依赖（跑页面级测试、构建产物断言用）
cd app && npm install
```

只有两个脚本需要**浏览器**（headless Chrome/Edge，自动探测路径；也可用 `CHROME_PATH` 指定）。

## 一、不需要数据库、不需要浏览器（最快）

| 脚本 | 验证什么 |
|---|---|
| `md-check.mjs` | README / DEPLOY 的行数、代码围栏是否闭合 |
| `check-block-usage.mjs` | 模板里不允许出现不带指令的裸 `<block>`（会被 H5 编译成 `<template>`，子节点不渲染） |
| `check-app-bundle.mjs` | App 打包产物内容核对：该在的在、旧代码必须 0 处 |
| `check-api-base.mjs <dist目录> <期望基址>` | 打包产物里的接口基址注入是否正确 |
| `sfc-check.mjs <file.vue>` | 单个 `.vue` 能否被 `@vue/compiler-sfc` 解析并编译 |
| `vue-ctx-check.mjs <file.vue>` | 模板里用到的标识符是否都在 `<script>` 里有定义 |
| `page-null-render.mjs <file.vue...>` | 用各页 `data()` 初值渲染模板，抓"在 null 上取属性"这类只在浏览器暴露的异常 |
| `star-paste-check.mjs` | 录入页「粘贴星数名单」解析器（精确/繁体/错字/括号/0星/重复/全角数字…） |
| `print-oriental-prompt.mjs` | 打印「东方幻境」默认值生成出来的完整提示词，便于人眼核对 |
| `audit-for-publish.mjs` | 发布前审计：只扫 **git 会提交的文件**，看有没有密钥/口令/私钥/IP 混进去 |
| `generate-handraw-styles.mjs <上游目录>` | 从 `yang0/handraw-style` 的 `styles.json` 生成 `app/src/utils/handraw-styles.js`（261 条 / 7 类；编号或分类对不上就报错退出） |
| `build-handraw-thumbs.mjs <上游目录>` | 从上游单图生成 `app/src/static/style-thumbs/*.webp`（320px、约 4 MB；该目录被 `.gitignore` 排除，第三方插画不进仓库） |

```bash
node tools/md-check.mjs
node tools/check-block-usage.mjs
node tools/check-app-bundle.mjs            # 需要先 cd app && npm run build:app
node tools/page-null-render.mjs app/src/pages/*/*.vue
node tools/star-paste-check.mjs
node tools/audit-for-publish.mjs
```

## 二、页面级流程测试（编译 SFC + 真渲染 + 请求桩，不需要浏览器）

这些用 `createRenderer` 配一套极简节点操作**真渲染**页面组件（不是 SSR：SSR 渲染后的实例 computed
不再失效重算，会让断言看到过期值），验证"页面胶水"——解析结果怎么进 computed、接口收到了什么 body、
保存成功后状态怎么复位。这些既不在纯函数单测里，也不在服务端 E2E 里。

| 脚本 | 断言 | 覆盖 |
|---|---|---|
| `members-archive-flow.mjs` | 84 | 成员页归档筛选、归档成员可查看/可恢复、访客只读入口 |
| `member-edit-archive-flow.mjs` | 30 | 成员编辑页对归档成员的处理与恢复提示 |
| `entry-paste-flow.mjs` | 110 | 录入页粘贴星数：解析→分组→提交体→复位→指认/新建/忽略→弹层层级 |
| `import-page-flow.mjs` | 21 | 批量导入页预览分类、勾选、apply 提交体 |
| `workshop-app-flow.mjs` | 61 | 创作工坊 App 适配层：按 App 条件编译剥源码 + 内存文件系统跑通 取图→存本机→上传→存相册 |
| `workshop-oriental-flow.mjs` | 32 | 东方幻境：直接自己写提示词也能生成、默认服装 |
| `wheel-guest-flow.mjs` | 21 | 转盘每日奖励：访客也能抽、只读门禁已删干净 |
| `wheel-fun-pick-flow.mjs` | 77 | 随机抽人自选成员：按本周分数分组、整组选中、只从勾选名单里抽 |
| `handraw-library-flow.mjs` | 174 | 工坊「风格提示词库」：261 条数据完整性、过滤与文案、页面接线（分类短名/分批渲染/追加不覆盖/复制反馈/参考图） |
| `star-paste-roster.json` | — | 上面几个脚本用到的成员名单数据 |

```bash
node tools/members-archive-flow.mjs
node tools/wheel-fun-pick-flow.mjs
node tools/workshop-oriental-flow.mjs
```

## 三、需要真实浏览器（headless Chrome + CDP）

| 脚本 | 验证什么 |
|---|---|
| `cdp-run.mjs` | 通用驱动：headless Chrome + CDP，按顺序执行 `{click}/{clickText}/{insertText}/{js}/{shot}/{wait}` 步骤，读计算后的布局、截图、输出 JSON（点击前会先把元素滚进视口，并给页面授予剪贴板读写权限） |
| `browser-page-check.mjs` | 真渲染巡检 6 个页面：DOM 里不允许出现真实 `<template>`、节点数达标、关键文案可见 |
| `wheel-fun-ui-check.mjs` | 真点击：切「随机抽人」→「自选成员」→ 点分数整组选中，断言计数/按钮状态/无横向溢出 |
| `handraw-library-ui-check.mjs` | 真点击 + **真键盘输入**：开「风格提示词库」→ 输入 041 → 切分类 → 复制（断言提示真在屏幕最上层，并把剪贴板读回来核对）/点参考图看大图/填入提示词 |
| `dev-server-page-check.mjs` | 运行中的 dev server 能否正常编译改动后的页面 |
| `serve-dist.mjs` | 极简静态服务器，给 `uni build` 产物起个可截图的服务 |

```bash
# 需要 dev server（它带 /api 代理）：
cd app && npm run dev:h5

node tools/browser-page-check.mjs http://localhost:5173
node tools/wheel-fun-ui-check.mjs http://localhost:5173
node tools/dev-server-page-check.mjs http://localhost:5173 /src/pages/wheel/wheel.vue
```

> ⚠️ 两个坑：
> 1. 用 `http://localhost:5173` 而不是 `127.0.0.1:5173` —— Vite 有时只绑 IPv6 的 `::1`，写 `127.0.0.1` 会连不上。
> 2. `cdp-run.mjs` 用 `Emulation.setDeviceMetricsOverride` 覆盖视口：headless 的 `--window-size` **不等于**
>    页面 CSS 视口（实测 `--window-size=430` 时 `innerWidth` 是 512），不覆盖的话截图会是
>    "布局按 512 排、图片只有 430 宽"，看起来像右侧被切掉。
> 3. **uni-app 的 `input` 必须给显式高度**：组件内部那个真 `<input>` 是 `height: 100%`，
>    父级高度 auto 时会被算成 **0 高**（H5 实测 `innerHeight=0`），表现为"框看着在、点进去打不了字"。
>    `handraw-library-ui-check.mjs` 用 `{insertText:{selector,text}}` 真键盘输入来防这个回归。

## 四、需要真实生图额度（会花钱，默认别跑）

| 脚本 | 说明 |
|---|---|
| `ai-generation-check.mjs [baseUrl]` | 打 `/api/ai-workshop` 走一次真生图（生成→轮询→取图），默认匿名访客身份 |

```bash
# 服务端 .env 配好 SILICONFLOW_API_KEY 后：
node tools/ai-generation-check.mjs http://127.0.0.1:3000/api
```

## 五、服务端测试（在 server/ 里）

```bash
cd server
npm test          # 周期计算单元测试（不需要数据库）
npm run test:e2e  # 起独立 MySQL + 真实后端跑 HTTP 端到端（448+ 条断言，独立端口/数据目录，不碰开发库与生产库）
npm run test:ai   # AI 工坊集成测试（mock 供应商，不需要真 key；含配额与 IP 限额）
```
