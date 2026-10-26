# dsh-bash

从 [`T-Auto/dsh-ops`](https://github.com/T-Auto/dsh-ops) **0.4.1**（commit `dfafddc`，MIT）中单独抽出的 **bash 组件**：
只做一件事——把 `ops_bash` 发布成一个具备宿主管辖（sandbox / 审批 / 输出溢出 / 后台 job）语义的 shell 工具。
file / PTC / discovery / panel / TUI / hide-official 这六条组件行全部没有移植。

- 不导入任何 `@deepseek-ai/*` 的**运行时值**（只有类型导入），加载期不会因为宿主包缺失而失败。
- 只通过 `ctx.get('subprocess') / ctx.get('sandboxPolicy') / ctx.get('sandbox') / ctx.get('jobs')` 借用宿主服务。
- 与宿主原生 `bash` 工具的差别：多一个 `script_path` 参数、更严格的参数校验、`failure.code/effectState/retry` 结构化失败信息。
- 标准 DSH 插件形态：`dsh-plugin.json`（manifest v0.15）+ `dsh.bundle.patch` 行 + `./shell` 组件导出 +
  根级图标与 `locale/{en,zh}.json`，`npm run validate:manifest` 用官方 `@dsh-std/manifest` 解析器过一遍。

## 二次开发来源标注

| 项 | 内容 |
| --- | --- |
| 上游项目 | [`T-Auto/dsh-ops`](https://github.com/T-Auto/dsh-ops) |
| 上游版本 / 提交 | `0.4.1` / `dfafddc`（Merge PR #403） |
| 上游许可 | MIT，Copyright (c) 2026 T-Auto and the dsh-ops contributors |
| 上游许可原文 | `licenses/dsh-ops-LICENSE`（原样保留） |
| 间接上游 | `@deepseek-ai/dsh-tool-bash` 0.2.0-rc.2（MIT，Copyright (c) 2026 DeepSeek），经 dsh-ops 转承；原文见 `licenses/deepseek-harness/LICENSE` |
| 逐文件对应关系与全部改动 | [`docs/PROVENANCE.md`](docs/PROVENANCE.md) |
| 第三方声明 | [`NOTICE`](NOTICE) |

本项目是**二次开发**而非上游发布物：包名、配置段、`DSH_HOME` 子目录、运维命令都改为 `dsh-bash`；
仅保留 bash 一条组件行；不管理 PowerShell；组件入口不导出 `Config`（见 PROVENANCE 的说明）。
上游原有的版权与许可声明全部保留，未替换。

## 目录

```
dsh-plugin.json              DSH manifest v0.15（host facet / Tool 契约 / 权限 / 组件与提示词声明）
cordis.patch.yml             唯一一行 dsh-bash-shell
locale/, docs/assets/        插件卡片用的语言文件与图标
src/index.ts                 组件入口：解析 bash → 发布工具 → 提示词段 → 可选禁用宿主 shell
src/components/shell/        Loader 行入口（dsh-bash/shell）
src/config.ts                行配置校验（未知键报错）
src/policy.ts                工具名 / 路由提示词（只描述 ops_bash 与宿主的 pwsh）
src/shells.ts + src/shells/  解析、探测、执行、结果渲染、job、宿主契约（原样移植）
src/session-shells.ts        按 agent/session 维度发布与撤销，跟随 sandboxPolicy 变化
src/shells/session-execution 每次调用的权限断言 + 受限模式 confinement 接线
src/bash-ipc.ts              Windows 受限模式的私有 MSYS 运行时缓存与校验
src/bash-pe.ts               MSYS DLL 补丁（把 KERNEL32/NTDLL 导入重定向到 IPC 代理）
src/workspace-preparation.ts Windows workspace ACL 前置（WRITE_OWNER）
src/workspace-preparation.ts → bin/prepare-workspace.ps1
scripts/provision-bash.mjs   安装固定版本的上游 bash（Git for Windows PortableGit）
scripts/build-bash-ipc.mjs   构建 Windows 受限模式所需 IPC 代理（需要 MSVC）
scripts/validate-manifest.mjs 官方 manifest 解析器 + 本仓库事实一致性检查
scripts/verify-install.mjs   检查某个 profile 里的安装状态
bin/dsh-bash.mjs             status / provision / build-ipc 运维命令
test/                        10 个套件（见下表）
.github/workflows/ci.yml     ubuntu 上 build + lib 同步 + manifest + 套件 + 类型检查
```

## 构建与验证

```powershell
npm install --ignore-scripts
npm run build            # src/ -> lib/（lib/ 已提交，供 git 安装直接用）
npm run validate:manifest
npm test                 # build + 全部 10 个套件
npm run verify           # build + manifest + 套件
node test/run.mjs mount  # 只跑文件名含 mount 的套件
```

测试套件（一个进程一个套件，`test/lib/harness.mjs` 汇总，`test/lib/host.mjs` 提供 Cordis 形态的宿主替身）：

| 套件 | 覆盖 | 用例 |
| --- | --- | --- |
| `config` | 默认值、未知键报错、旧 dsh-ops 键、类型/边界 | 13 |
| `resolution` | 配置 → store → 包内 → PATH/常见路径的优先级、WSL 排除、POSIX 分支、永不抛异常 | 13 |
| `tool-contract` | `ops_bash` 名称、参数表与执行器一致、输出 schema、`resolve()` 校验矩阵、渲染标记 | 19 |
| `execution` | 真实命令、关闭的 stdin、`script_path`、workdir、超时杀进程树、取消、截断+spill、诊断、权限断言 | 18 |
| `mount` | 真实 `apply()` 挂载：发布/撤销、升级审批拒绝、jobs 参数、`deny-host-shell`、幂等重算 | 17（1 跳过） |
| `policy` | 路由提示词各分支、宿主 shell 拒绝理由 | 10 |
| `workdir` | Windows/POSIX 锚定规则、`/d/` 映射、跨盘拒绝、UNC、非法输入 | 13 |
| `restricted-ipc` | 受限模式门槛、回执校验、私有运行时 PATH、重命名重试、隔离目录 | 11 |
| `provisioner` | store 回执归属、预览/删除、`selectBashRuntime`、Git 探测 | 12 |
| `packaging` | manifest/导出/bundle patch/提示词段/图标与语言文件一致性、零宿主值导入 | 18 |

本机实测（Windows 11 / Node 24.20 / DSH 0.2.1-rc.3）：`ALL SUITES PASSED: 10/10`，共 144 个用例（1 个按平台跳过）。

**真实宿主启动验证**：用一个临时 profile（`dsh <profile> --from-default-profile web`）装上本包后启动 web 应用，
`--dump-config` 里出现 `# == dsh-bash` → `dsh-bash-shell` 行，启动 stderr 无 `did not activate` 警告，
说明 Loader 能解析 bundle patch 并成功激活该行。

> 移植经验（踩过的坑）：组件行入口**不能**导出一个普通函数当 `Config`。Loader 会把它当
> schemastery schema 调 `.validate`，直接报 `Cannot read properties of undefined (reading 'validate')`
> 并让整行激活失败。校验放在 `apply()` 里，未知键仍然报错。

## 安装 bash 载荷

Windows 本身没有 POSIX bash，dsh-ops 的做法是钉住上游发行版并校验摘要。这个包保留了同一套机制：

```powershell
node bin/dsh-bash.mjs provision     # 下载并校验 PortableGit 2.56.0.2 -> %USERPROFILE%\.dsh\dsh-bash\shells\bash\2.56.0.2
node bin/dsh-bash.mjs status        # 当前会跑哪个 bash、来源、受限模式兼容性
```

解析顺序（`src/shells/resolve.ts`）：

1. 配置里的 `bashPath`（不可用就报错，不会偷偷换一个 shell）
2. `<DSH_HOME>/dsh-bash/shells/bash/<version>/bin/bash.exe`
3. 包内 `vendor/bash/<platform>-<arch>/` 或 `@dsh-bash/bash-<platform>-<arch>` 平台包
4. `allowSystemShellFallback: true` 时才查 `PATH` 与常见安装位置（Windows 会主动排除 WSL 的 `System32\bash.exe`）

POSIX 上直接用发行版自带的 bash（同样支持 `bashPath` 覆盖）。

## 受限模式（read-only / workspace-write）

`danger-full-access` 下任意被解析到的 bash 都能跑。受限模式在 Windows 上只跑**固定版本的 MSYS**：
`runtime/win32-x64/bash-ipc/provenance.json` 必须存在，`msys-2.0.dll` 的摘要必须与回执一致，
两个 IPC 代理 DLL 会被逐字节校验后复制进 `<DSH_HOME>/dsh-bash/bash-ipc/<identity>/`。

构建这套代理需要 VS C++ 工具链：

```powershell
$env:DSH_OPS_VCVARS64 = "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
node bin/dsh-bash.mjs build-ipc
```

没有回执时受限模式会明确拒绝并给出修复路径（本机就是这样：无 MSVC，`status` 显示
`restricted modes: unavailable`），不会退化为不受限执行。

## 配置

`cordis.patch.yml` 里的 `dsh-bash-shell` 行：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `bashPath` | — | 绝对路径；设置后以它为准，不可用即报错 |
| `publishBashTool` | `true` | 是否发布 `ops_bash` |
| `shellPolicy` | `advise` | `deny-host-shell` 会隐藏并拒绝宿主 `bash`/`pwsh`/`pwsh_persistent` |
| `deniedHostTools` | 上述三个 | `deny-host-shell` 的拒绝清单 |
| `promptPolicy` | `true` | 是否发布 shell 路由提示词段 |
| `extraGuidance` | `""` | 追加到提示词段的说明 |
| `allowSystemShellFallback` | `false` | 是否允许回落到系统 bash（仅 Windows 需要显式打开） |

`serverName` / `enableShellTools` / `toolCallTimeoutMs` 是 dsh-ops 旧行遗留键：接受并忽略，便于直接从 dsh-ops 行复制配置。

## 安装

仓库地址：<https://github.com/null0xfff/dsh-bash>。`lib/` 已随仓库提交，所以从 git 安装不需要本地 TypeScript。

```powershell
# 桌面端必须用应用自带的 CLI
& "<安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add github:null0xfff/dsh-bash
# 或者用 npm 包（发布后）
& "<安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add dsh-bash
```

安装后装一次钉住的 bash 载荷，然后重启应用（或让插件管理器重载 profile）：

```powershell
node bin/dsh-bash.mjs provision
node bin/dsh-bash.mjs status
```

### 本机现状

本机 `dsh plugin ... add` 被**无关依赖**挡住：`dsh-purge` 的 GitHub 归档摘要与 lockfile 不一致
（`ERR_PNPM_TARBALL_INTEGRITY`），pnpm 拒绝继续，与本插件无关。因此本机改用等价的手工安装：

1. 把 tarball 解到 `<DSH_HOME>\profiles\desktop\node_modules\dsh-bash`；
2. profile `package.json` 加 `"dsh-bash": "file:C:/.../bash-module"`；
3. 把 `"dsh-bash"` 追加到 `dsh.profile.bundles`；
4. 重启应用——`ops_bash` 才会出现在工具表里。

安装状态可随时自检（只读，不启动应用）：

```powershell
node scripts/verify-install.mjs desktop
# package/dependency/bundle row/bash/source/restricted 六项，附结论
```

若日后修好 `dsh-purge` 的摘要问题，把手工步骤换回标准的 `dsh plugin ... add` 即可，
profile 里的依赖与 bundles 条目已经是它需要的形态。

## 与 dsh-ops 的行为差异

- 包名、配置段名、`DSH_HOME` 子目录都是 `dsh-bash`，与 dsh-ops 并存不冲突（互不读取对方的 store）。
- 不再提供 pwsh 托管：宿主的 PowerShell 保持原样，只有提示词里提到它。
- 不再有 file 工具的凭据围栏、结果引用、PTC SDK；因此 `ctx.get('result')` 之类服务完全不需要。
- 提示词段只描述 `ops_bash` 与宿主 `pwsh`，不再包含 `ops_*` 文件工具表格。

## 许可与来源

- 移植自 **dsh-ops**（MIT，Copyright (c) 2026 T-Auto and the dsh-ops contributors），见 `licenses/dsh-ops-LICENSE`。
- `src/shells/host-tool.ts`、`src/shells/host-contract.ts`、`src/shells/approval.ts` 另改编自 `@deepseek-ai/dsh-tool-bash` 0.2.0-rc.2（MIT，Copyright (c) 2026 DeepSeek），见 `licenses/deepseek-harness/LICENSE`。
- Windows bash 载荷来自 Git for Windows（GPL-2.0 等组件），仅按 dsh-ops 的钉住版本与摘要下载，不随包分发；`native/bash-ipc/*.cpp` 为 dsh-ops 原创 MIT 代码。
