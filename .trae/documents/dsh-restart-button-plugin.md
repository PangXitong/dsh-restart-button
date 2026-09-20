# dsh-restart-button 插件实现计划

## Context（背景）

用户要创建一个 DeepSeek Harness（dsh）插件，在 DSH Web UI 的主界面工具栏里加一个关机图标按钮，点击后向右侧展开「关闭 / 重启」两个按钮：
- **关闭**：关闭整个 DSH 进程
- **重启**：重启整个 DSH 进程

插件用 TypeScript 编写，开源到 `https://github.com/PangXitong/dsh-restart-button`，支持两种安装方式：
- `dsh plugin --profile web add github:PangXitong/dsh-restart-button`（GitHub）
- `dsh plugin --profile web add @pangxitong/dsh-restart-button`（npm）

项目目录当前只有 `README.md`（一行说明）和 `LICENSE`（Apache-2.0），是空仓库。

### 关键技术调研结论（已验证）

DSH 插件是「双半侧」结构，参考插件 `@huangzhaoyu/zhaoyu-restart` 的源码已完整获取并验证：

1. **物理结构**：`package.json`（声明 `dsh.bundle.patch` + `dsh.client`）+ `cordis.patch.yml`（插入补丁）+ `lib/index.js`（Host，Node 进程）+ `lib/client.js`（Client，浏览器）。`lib/` 预构建入库，安装时免构建。

2. **Host 半侧**（`lib/index.js`）：跑在 DSH 主进程（Node）。用 `ctx.inject(['webServer'], ctx => ctx.webServer.register({kind:'exact', path, handler}))` 注册 HTTP 路由；Client 用 `fetch` 同源调用。

3. **Client 半侧**（`lib/client.js`）：必须打成 `window.__ModuleLoader__.load({ id, factory: (require) => {...} })` 格式，DSH 的 client-modules 系统据此加载。

4. **工具栏注入**：DSH 的 slots 都是会话区相关（`conversation.input.left`、`conversation.input.attachments`、`conversation.message.images`），**没有暴露主界面工具栏槽位**。因此采用 **DOM 注入**（`dsh-delete-session` 同款做法）：用 `MutationObserver` 监听并找到工具栏，插入按钮。这种方式不依赖 React/`react-dom`，纯 DOM 操作，最稳妥。

5. **重启机制（用户确认：自包含 spawn）**：参考插件用外部 `.bat` + 硬编码路径，不便分发。本插件自包含：用 `process.execPath`（node）+ `process.argv.slice(1)`（启动参数）spawn 一个 **detached**、隐藏窗口的子进程，延迟 2 秒后重新拉起同一个命令，再 `process.exit(0)`。跨平台（Windows 用 powershell 隐藏窗口、Mac/Linux 用 sh）。无需外部脚本。

---

## 目标项目结构

```
dsh-restart-button/
├── package.json              # 插件声明（dsh.bundle + dsh.client）
├── cordis.patch.yml          # 一行插入补丁
├── tsconfig.json             # 纯 ESM，bundler 解析
├── build.mjs                 # esbuild 构建脚本（host→ESM / client→__ModuleLoader__ 格式）
├── .gitignore
├── README.md                 # 更新为完整安装/使用说明
├── LICENSE                   # 已存在，保留 Apache-2.0
├── src/
│   ├── index.ts              # Host 半侧源码（Node，注册 close/restart 路由）
│   └── client/
│       └── index.ts          # Client 半侧源码（纯 DOM 注入工具栏按钮）
└── lib/                      # 构建产物（入库，免构建安装）
    ├── index.js
    ├── client.js
    └── client.js.map
```

---

## 需创建/修改的文件

### 1. `package.json`
- `name`: `"@pangxitong/dsh-restart-button"`（npm scope 全小写）
- `version`: `"0.1.0"`，`type: "module"`，`main: "lib/index.js"`
- `exports`：`.` → `lib/index.js`、`./client` → `lib/client.js`、`./package.json` → `package.json`
- `dsh.bundle.patch`: `"./cordis.patch.yml"`；`dsh.client`: `{ "platform": "web", "inject": [] }`
- `files`: `["lib", "cordis.patch.yml", "README.md", "LICENSE"]`
- `scripts.build`: `"node build.mjs"`
- `peerDependencies`: `{ "@deepseek-ai/cordis": "^4.0.1" }`（自包含重启不依赖 dsh-settings/schemastery）
- `devDependencies`: `esbuild`（构建用，不入发布产物）
- `license`: `"Apache-2.0"`，`repository` 指向 GitHub 仓库

### 2. `cordis.patch.yml`
```yaml
# dsh-restart-button: DSH Web 工具栏关机按钮，展开可关闭/重启 DSH
- insert:
    - id: dsh-restart-button
      name: '@pangxitong/dsh-restart-button'
```

### 3. `src/index.ts`（Host 半侧）
导出 `name = 'dsh-restart-button'`、`inject = []`，`apply(ctx)`：
- `ctx.inject(['webServer'], (httpCtx) => httpCtx.effect(() => { 注册两条路由，返回 dispose }))`
- **`POST /dsh-restart-button/close`**：校验方法 → 返回 `{ ok: true, action: 'close' }` → `setTimeout(() => process.exit(0), 300)`（让响应先 flush）
- **`POST /dsh-restart-button/restart`**：校验方法 → 调 `relaunchDetached()` → 返回 `{ ok: true, action: 'restart' }` → `setTimeout(() => process.exit(0), 300)`
- **`relaunchDetached()`**（自包含重启核心）：
  - `isWin = os.platform() === 'win32'`
  - `execPath = process.execPath`、`args = process.argv.slice(1)`
  - Windows：`spawn('powershell.exe', ['-WindowStyle','Hidden','-NoProfile','-Command', "Start-Sleep -Seconds 2; & '<execPath>' '<arg1>' '<arg2>' ..."], { detached:true, stdio:'ignore', windowsHide:true }).unref()`
  - Mac/Linux：`spawn('sh', ['-c', "sleep 2; exec '<execPath>' '<arg1>' ..."], { detached:true, stdio:'ignore' }).unref()`
  - 路径中的单引号做转义（Win 用 `''`、Unix 用 `'\''`）
  - 用 `node:child_process` 的 `spawn`、`node:os`，零运行时依赖
- 路由 handler 内 `try/catch`，失败返回 500 + `{ ok:false, error }`

### 4. `src/client/index.ts`（Client 半侧，纯 DOM 注入）
导出 `inject = []`、`apply(ctx)`：
- **`ensureButton()`**：用 `MutationObserver` 监听 `document.body`，找到工具栏容器后注入关机按钮（带幂等：已注入则跳过）
  - 工具栏定位（多策略降级）：`[role="toolbar"]` → `header` → 顶部应用栏（常见 class/data 属性）→ 兜底：`document.body` 第一个 flex 容器
  - 用 `data-dsh-restart-button` 属性标记容器，避免重复注入
- **关机按钮**：纯 DOM `createElement`，SVG 关机图标（圆弧 + 竖线 ⏻），悬浮态、标题「关闭 / 重启 DSH」
- **展开菜单**：点击关机按钮 → 在按钮右侧展开一个小气泡，含两个按钮：
  - 「关闭」(red) → `fetch('/dsh-restart-button/close', {method:'POST'})`，按钮显示「关闭中…」
  - 「重启」 → `fetch('/dsh-restart-button/restart', {method:'POST'})`，按钮显示「重启中…」
  - 再次点击关机按钮或点外部 → 收起菜单
  - 菜单样式内联（不依赖 DSH 主题类），跟随系统深浅色（`color-scheme` + `currentColor`）
- 点击后请求发出即视为成功（进程退出后浏览器会断线重连），失败（fetch reject）才恢复按钮态并提示
- 用 `ctx`（可选）：若 `ctx.get('slots')` 存在则忽略（保持 DOM 注入），保证降级

### 5. `build.mjs`（esbuild 构建）
- 依赖 `esbuild`（devDependency）
- **Host**：`build({ entryPoints:['src/index.ts'], bundle:true, format:'esm', platform:'node', target:'node22', external:['@deepseek-ai/cordis','@deepseek-ai/dsh-settings','@deepseek-ai/schemastery'], outfile:'lib/index.js', sourcemap:true })`
- **Client**：先 `build({ entryPoints:['src/client/index.ts'], bundle:true, format:'cjs', platform:'browser', target:'es2022', outfile:'lib/client.tmp.js' })`（纯浏览器全局 API，无 externals）
  - 再读取产物，包进 `window.__ModuleLoader__.load({ id:"dsh-restart-button", factory:(require)=>{ var module={exports:{}}; var exports=module.exports; <产物> return module.exports; } });` 写入 `lib/client.js`，删除 tmp，并生成 `client.js.map`
- `console.log` 输出构建结果

### 6. `tsconfig.json`
纯 ESM、`moduleResolution: "bundler"`、`strict: true`、`lib: ["ES2022","DOM"]`（client 用 DOM 类型）、`noEmit: true`（构建交给 esbuild）

### 7. `.gitignore`
忽略 `node_modules/`、`lib/client.tmp.js`；**保留** `lib/index.js`、`lib/client.js`、`lib/*.map`（预构建入库）

### 8. `README.md`（更新）
- 标题 + 简介 + 截图占位
- 两种安装命令（GitHub / npm）
- 使用说明（工具栏关机按钮 → 展开关闭/重启）
- 工作原理（Host 路由 + Client DOM 注入 + 自包含 spawn 重启）
- 兼容性（DSH 0.1.x，Node ≥22）+ 许可证 Apache-2.0

---

## 实现顺序

1. 写 `package.json`、`cordis.patch.yml`、`tsconfig.json`、`.gitignore`
2. 写 `src/index.ts`（Host：close/restart 路由 + `relaunchDetached`）
3. 写 `src/client/index.ts`（Client：DOM 注入关机按钮 + 展开菜单 + fetch）
4. 写 `build.mjs`（esbuild 双产物 + client 包 `__ModuleLoader__`）
5. `pnpm install`（装 esbuild）→ `pnpm run build` → 检查 `lib/` 产物
6. 更新 `README.md`
7. 自检：`node -e` 跑一下 `lib/index.js` 的导入语法；肉眼核对 `lib/client.js` 格式

---

## 验证方式

无法在当前环境跑起完整 DSH（需要 Node ≥22 + DSH 守护进程），但可做：

1. **构建验证**：`pnpm install && pnpm run build`，确认 `lib/index.js`（ESM）和 `lib/client.js`（`window.__ModuleLoader__.load` 格式）生成且无报错。
2. **格式校验**：肉眼/`grep` 检查 `lib/client.js` 顶部是 `window.__ModuleLoader__.load({`、`lib/index.js` 是 ESM `export`。
3. **语法校验**：`node --check lib/index.js` 确认 Host 产物语法合法；`lib/client.js` 用 `node --check` 校验（IIFE 合法）。
4. **真实安装测试（用户侧）**：用户本地有 DSH 时：
   - `dsh plugin --profile web add github:PangXitong/dsh-restart-button`
   - 重启 DSH → 刷新页面 → 工具栏出现关机按钮
   - 点关机按钮 → 右侧展开「关闭/重启」→ 点关闭验证 DSH 退出、点重启验证 DSH 重启后浏览器自动重连
5. 若工具栏 DOM 选择器未命中（DSH 版本差异），用户可在 `src/client/index.ts` 的工具栏定位策略里补充选择器后重新 `pnpm run build`。
