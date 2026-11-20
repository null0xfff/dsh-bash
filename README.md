# dsh-bash

简体中文 | [English](./README.en.md)

`dsh-bash` 将 [T-Auto/dsh-ops](https://github.com/T-Auto/dsh-ops) 中的 Bash 组件独立出来，为 DeepSeek Harness（DSH）Agent 提供 `ops_bash` 工具。如果你需要在仓库中运行 Bash 命令或脚本，并沿用 DSH 本身的会话权限、沙箱与审批流程，同时默认保留宿主自带的 Bash 和 PowerShell 工具，可以使用这个插件。

## 安装插件

1. 在目标 DSH 应用中打开 **插件 → 添加插件**。
2. 选择 Git 来源，填入：

```text
github:null0xfff/dsh-bash
```

仓库已包含编译产物（`lib/`），从 Git 安装无需本地编译 TypeScript。安装并启用插件后，如果使用 Windows，请继续完成下方的 Bash 运行时准备。

## 准备 Bash 运行时

安装插件与准备 Bash 是两个独立步骤：

- **Linux / macOS**：默认直接解析系统中的 Bash，通常无需额外下载。
- **Windows x64**：默认使用固定版本的 Git for Windows PortableGit `2.56.1`，需要单独下载并校验载荷。

在 Windows x64 上，从插件包根目录运行以下命令，下载载荷并查看状态。

```sh
node bin/dsh-bash.mjs provision
node bin/dsh-bash.mjs status
```

- `provision` 会下载并校验固定版本的 PortableGit 载荷（存入 `<DSH_HOME>/dsh-bash/shells`）。
- `status` 会按默认配置报告当前找到的 Bash 路径以及受限模式兼容性。

### Windows 受限模式（`read-only` / `workspace-write`）

在 `danger-full-access` 下，任何已解析到的 Bash 都可以运行；但在 Windows 上启用 `read-only` 或 `workspace-write` 受限模式，还需要与当前载荷匹配的 MSYS IPC 组件与校验记录。缺少匹配组件时，受限执行会被明确拒绝，不会静默退化为不受限执行。

因此，运行 `node bin/dsh-bash.mjs status` 后可能会看到如下两行：

- `bash: available`：已找到可用 Bash，可以在 `danger-full-access` 下执行命令。
- `restricted modes: unavailable`：当前插件包缺少匹配的 MSYS IPC 组件，受限模式（`read-only` / `workspace-write`）不可用。

如需在 Windows x64 上启用受限模式，请在安装好 Visual Studio C++ 工具链后，**针对 DSH 实际加载的那份插件包目录**运行 `build-ipc`（必要时先设置 `DSH_OPS_VCVARS64` 指向 `vcvars64.bat`）：

```powershell
$env:DSH_OPS_VCVARS64 = "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
node bin/dsh-bash.mjs build-ipc
```

完成后重新运行 `node bin/dsh-bash.mjs status` 确认状态。

## 首次使用

配置就绪并重载或重启 DSH 应用后，向 Agent 发送以下消息：

```text
用 ops_bash 运行 `printf 'hello from bash\n'`
```

预期输出：

```text
hello from bash
```

### 运行机制与参数说明

- 每次调用 `ops_bash` 都会启动一个新的 shell 进程。
- 单次调用在 `command`（内联命令）和 `script_path`（脚本路径）中二选一，可选通过 `workdir` 指定工作目录。
- 后台任务（background jobs）能力取决于宿主是否提供相应的 job 服务和控制器。

## 常用配置

插件通过 [`cordis.patch.yml`](./cordis.patch.yml) 向 profile 注入 `dsh-bash-shell` 组件行，常用配置项如下：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `bashPath` | 未设置 | 指定 Bash 可执行文件的绝对路径；设置后以该路径为准，不可用时直接报错。 |
| `allowSystemShellFallback` | `false` | 控制 Windows 下找不到托管载荷时，是否允许回落查找系统 Bash。 |
| `publishBashTool` | `true` | 是否向 Agent 发布 `ops_bash` 工具。 |
| `shellPolicy` | `"advise"` | 默认保留宿主 Shell 工具；设为 `"deny-host-shell"` 时会隐藏并拒绝宿主的 `bash`、`pwsh` 与 `pwsh_persistent`。 |

完整配置字段与校验规则见 [`src/config.ts`](./src/config.ts) 与 [`cordis.patch.yml`](./cordis.patch.yml)。

## 兼容范围与开发验证

- **当前版本**：`0.1.4`
- **Node.js**：`^22.19 || >=24`
- **DSH 兼容范围**：`0.2.1-rc.2 || 0.2.1-rc.3 || >=0.2.2-rc.1 <0.2.3-0`
  - **已实测**：`0.2.2-rc.1` 至 `0.2.2-rc.5` 均已使用实际宿主组件验证执行、任务与权限边界；`0.2.1-rc.2` 与 `0.2.1-rc.3` 已验证按 Agent 发布、前台执行，以及切换为只读且无沙箱时撤销工具。
  - **版本策略**：同一 `0.2.2` 线的后续 RC 与正式版按语义化版本范围准入；`0.2.3` 从预发布版起需要重新验收。

开发者可在仓库根目录运行以下命令进行验证：

```sh
npm ci --ignore-scripts
npm run verify
npm run typecheck
```

## 许可与来源

本项目基于 MIT 许可发布，详情见 [`LICENSE`](./LICENSE) 与 [`NOTICE`](./NOTICE)：

- **直接上游**：[T-Auto/dsh-ops](https://github.com/T-Auto/dsh-ops) `0.4.1`（提交 `dfafddc`，MIT 许可），许可原文保留在 [`licenses/dsh-ops-LICENSE`](./licenses/dsh-ops-LICENSE)。
- **间接上游**：部分工具契约经 `dsh-ops` 改编自 `@deepseek-ai/dsh-tool-bash` `0.2.0-rc.2`（MIT 许可），许可原文保留在 [`licenses/deepseek-harness/LICENSE`](./licenses/deepseek-harness/LICENSE)。
- **逐文件溯源与改动说明**：见 [`docs/PROVENANCE.md`](./docs/PROVENANCE.md)。
- **Windows Bash 载荷**：由 `node bin/dsh-bash.mjs provision` 单独从上游下载（Git for Windows PortableGit `2.56.1`），适用其上游许可证（包含 GPL-2.0 等组件），不随本仓库直接分发。