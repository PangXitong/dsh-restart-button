# dsh-restart-button

在 DeepSeek Harness（dsh）Web UI 的会话头部右侧工具区新增一个**关机按钮**，点击后展开「关闭 / 重启」两个操作，一键关闭或重启整个 DSH 进程。

> A power button in the DeepSeek Harness (dsh) Web UI session header. Click to expand a **Close / Restart** pair that shuts down or relaunches the whole DSH process.

## 特性

- 会话头部右侧工具区（工具栏）的关机图标按钮（⏻），悬浮高亮
- 点击展开菜单：「重启」「关闭」
  - **关闭**：立即关闭整个 DeepSeek Harness 进程
  - **重启**：拉起一个独立、隐藏的子进程，2 秒后重新启动同一个 DSH 命令，旧标签页自动断线重连
- 自包含重启：用 `process.execPath` + `process.argv` 重新拉起 DSH，**无需任何外部 `.bat` / `.sh` 脚本**，跨平台（Windows / macOS / Linux）
- 注册进 DSH 官方插槽 `conversation.session.header.utilities`，不改 DSH 核心；由 React 正常渲染，不依赖 DOM 结构猜测

## 安装

在终端执行：

```bash
dsh plugin --profile web add github:PangXitong/dsh-restart-button
```

然后重启 DSH，刷新页面，工具栏右侧即出现关机按钮。

## 使用

1. 点击工具栏右侧的关机按钮（⏻）→ 下方展开菜单
2. 点击「关闭」→ DSH 进程退出
3. 点击「重启」→ DSH 进程重启，浏览器标签页断线后自动重连

## 工作原理

插件采用 DSH 的「双半侧」结构：

| 半侧 | 文件 | 职责 |
| --- | --- | --- |
| Host（`lib/index.js`，Node 主进程） | `src/index.ts` | 通过 `ctx.inject(['webServer'])` 注册两条同源 HTTP 路由：`POST /dsh-restart-button/close`（`process.exit(0)`）与 `POST /dsh-restart-button/restart`（spawn 独立子进程重拉 DSH 后退出） |
| Client（`lib/client.js`，浏览器） | `src/client/index.tsx` | 通过 `ctx.slots.inject('conversation.session.header.utilities', …)` 把关机按钮注册进会话头部右侧工具区（`kind: 'list'` 官方插槽）；点击按钮 `fetch` 同源路由 |

重启核心逻辑见 [src/index.ts](src/index.ts) 的 `relaunchDetached()`：用当前进程的 `process.execPath`（node）与 `process.argv.slice(1)`（启动参数，含 `--profile` 等）构造一条延迟 2 秒后重新执行的命令，以 detached、隐藏窗口方式 spawn，再让当前进程退出。因此无论你用 `dsh web`、`npx @deepseek-ai/dsh web` 还是 `node /path/to/dsh web` 启动，都能正确重启。

客户端用 DSH 官方的插槽机制落位，而不是猜测 DOM：`conversation.session.header.utilities` 是 ui-conversation 声明的 `kind: 'list'` 座位，和宿主自己的「Session log」胶囊同一行，按 `order` 插在流内，因此不会与宿主控件重叠。`slots.inject` 会等待该座位的声明出现（可能晚于本插件激活），声明被撤销后重新声明时会再次回调。React 由 DSH 客户端模块表作为平台基线模块提供，产物中只保留 `require('react')`，不打包第二份 React。

## 构建

源码用 TypeScript，`lib/` 预构建入库，安装时免构建。如需从源码重新构建：

```bash
pnpm install
pnpm run build        # node build.mjs，依赖 esbuild
```

产物：`lib/index.js`（ESM，Host）+ `lib/client.js`（`window.__ModuleLoader__.load` 格式，Client）。

## 兼容性

- DeepSeek Harness `0.1.5+`（开发该插件时的版本；会话头部工具插槽 `conversation.session.header.utilities` 需存在于 ui-conversation）
- Node.js `^22.19.0` 或 `>=24`
- 平台：Windows / macOS / Linux

> 该插槽属于 DSH 0.1.x 开发者预览版契约，破坏性更新后可能需要调整插槽名。插槽名在 `src/client/index.tsx` 的 `SLOT_HEADER_UTILITIES` 常量里；`src/client/react-shim.d.ts` 只是为了让本仓库在未安装 `@types/react` 时也能通过类型检查，若之后加入 `@types/react`，删掉该文件即可。

## 许可证

Apache-2.0
