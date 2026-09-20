# dsh-restart-button

在 DeepSeek Harness（dsh）Web UI 的主界面工具栏新增一个**关机按钮**，点击后向右侧展开「关闭 / 重启」两个操作，一键关闭或重启整个 DSH 进程。

> A power button for the DeepSeek Harness (dsh) Web UI toolbar. Click to expand a **Close / Restart** pair that shuts down or relaunches the whole DSH process.

## 特性

- 主界面工具栏的关机图标按钮（⏻），悬浮高亮
- 点击展开右侧气泡菜单：「重启」「关闭」
  - **关闭**：立即关闭整个 DeepSeek Harness 进程
  - **重启**：拉起一个独立、隐藏的子进程，2 秒后重新启动同一个 DSH 命令，旧标签页自动断线重连
- 自包含重启：用 `process.execPath` + `process.argv` 重新拉起 DSH，**无需任何外部 `.bat` / `.sh` 脚本**，跨平台（Windows / macOS / Linux）
- 纯 DOM 注入，不改 DSH 核心；DSH 版本变化导致工具栏选择器未命中时，8 秒后自动降级为右上角浮动按钮

## 安装

在终端执行其中一种：

```bash
# 从 GitHub 安装
dsh plugin --profile web add github:PangXitong/dsh-restart-button

# 或从 npm 安装（需先发布到 npm）
dsh plugin --profile web add @pangxitong/dsh-restart-button
```

然后重启 DSH，刷新页面，工具栏右侧即出现关机按钮。

## 使用

1. 点击工具栏右侧的关机按钮（⏻）→ 右侧弹出菜单
2. 点击「关闭」→ DSH 进程退出
3. 点击「重启」→ DSH 进程重启，浏览器标签页断线后自动重连

## 工作原理

插件采用 DSH 的「双半侧」结构：

| 半侧 | 文件 | 职责 |
| --- | --- | --- |
| Host（`lib/index.js`，Node 主进程） | `src/index.ts` | 通过 `ctx.inject(['webServer'])` 注册两条同源 HTTP 路由：`POST /dsh-restart-button/close`（`process.exit(0)`）与 `POST /dsh-restart-button/restart`（spawn 独立子进程重拉 DSH 后退出） |
| Client（`lib/client.js`，浏览器） | `src/client/index.ts` | 用 `MutationObserver` 监听并定位工具栏容器，纯 DOM 注入关机按钮与展开菜单；点击按钮 `fetch` 同源路由 |

重启核心逻辑见 [src/index.ts](src/index.ts) 的 `relaunchDetached()`：用当前进程的 `process.execPath`（node）与 `process.argv.slice(1)`（启动参数，含 `--profile` 等）构造一条延迟 2 秒后重新执行的命令，以 detached、隐藏窗口方式 spawn，再让当前进程退出。因此无论你用 `dsh web`、`npx @deepseek-ai/dsh web` 还是 `node /path/to/dsh web` 启动，都能正确重启。

## 构建

源码用 TypeScript，`lib/` 预构建入库，安装时免构建。如需从源码重新构建：

```bash
pnpm install
pnpm run build        # node build.mjs，依赖 esbuild
```

产物：`lib/index.js`（ESM，Host）+ `lib/client.js`（`window.__ModuleLoader__.load` 格式，Client）。

## 兼容性

- DeepSeek Harness `0.1.x`（开发者预览版，存在破坏性更新）
- Node.js `^22.19.0` 或 `>=24`
- 平台：Windows / macOS / Linux

> 若 DSH 版本更新导致工具栏 DOM 选择器未命中，可在 `src/client/index.ts` 的 `findToolbarContainer()` 里补充选择器后 `pnpm run build` 重新生成 `lib/`。

## 许可证

Apache-2.0
