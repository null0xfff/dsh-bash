# dsh-bash

[简体中文](./README.md) | English

`dsh-bash` extracts the Bash component from [T-Auto/dsh-ops](https://github.com/T-Auto/dsh-ops) as a standalone DeepSeek Harness (DSH) plugin that provides the `ops_bash` tool to DSH Agents. Use it when you need to run Bash commands or scripts in a repository under DSH session permissions, sandboxing, and approval rules while keeping the host's built-in Bash and PowerShell tools enabled by default.

## Install the plugin

1. Open **Plugins → Add plugin** in your DSH application.
2. Choose the Git source and enter:

```text
github:null0xfff/dsh-bash
```

The repository includes pre-built output (`lib/`), so installing from Git does not require compiling TypeScript locally. After installing and enabling the plugin, complete the Bash runtime setup below if you are on Windows.

## Prepare the Bash runtime

Installing the plugin and preparing Bash are two separate steps:

- **Linux / macOS**: Uses the system Bash by default and normally requires no extra download.
- **Windows x64**: Uses a pinned Git for Windows PortableGit `2.56.0.2` runtime by default, which must be downloaded and verified separately.

On Windows x64, run these commands from the plugin package root to download PortableGit and check its status.

```sh
node bin/dsh-bash.mjs provision
node bin/dsh-bash.mjs status
```

- `provision` downloads and verifies the pinned PortableGit payload (stored under `<DSH_HOME>/dsh-bash/shells`).
- `status` reports the Bash executable resolved under the default configuration and checks restricted-mode compatibility.

### Restricted modes on Windows (`read-only` / `workspace-write`)

Any resolved Bash can run under `danger-full-access`. On Windows, running `read-only` or `workspace-write` also requires matching MSYS IPC binaries and a provenance record. If matching components are absent, restricted execution is explicitly rejected instead of falling back to unconfined execution.

When you run `node bin/dsh-bash.mjs status` on Windows, the two status lines mean:

- `bash: available` — A usable Bash executable was found and can run under `danger-full-access`.
- `restricted modes: unavailable` — Matching MSYS IPC components are missing from this plugin package, so `read-only` and `workspace-write` execution are disabled.

To enable restricted modes on Windows x64, install the Visual Studio C++ build tools and run `build-ipc` **against the exact plugin package directory loaded by DSH** (pointing `DSH_OPS_VCVARS64` to `vcvars64.bat` if needed):

```powershell
$env:DSH_OPS_VCVARS64 = "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
node bin/dsh-bash.mjs build-ipc
```

Re-run `node bin/dsh-bash.mjs status` afterward to verify both lines.

## First run

Once the runtime is ready and DSH has reloaded or restarted, send this prompt to your Agent:

```text
Run `printf 'hello from bash\n'` with ops_bash
```

Expected output:

```text
hello from bash
```

### Execution behavior

- Each `ops_bash` call starts a fresh shell.
- Pass either `command` or `script_path` per call, with an optional `workdir` to set the working directory.
- Background job support depends on whether the host provides the corresponding job service and controller.

## Common configuration

The plugin injects a `dsh-bash-shell` component row via [`cordis.patch.yml`](./cordis.patch.yml). The most common options are:

| Option | Default | Description |
| --- | --- | --- |
| `bashPath` | unset | Absolute path to a specific Bash executable. When set, resolution uses this path strictly and fails if unavailable. |
| `allowSystemShellFallback` | `false` | Controls whether Windows falls back to searching for a system Bash when no managed payload is found. |
| `publishBashTool` | `true` | Controls whether `ops_bash` is published to the Agent. |
| `shellPolicy` | `"advise"` | Keeps host shell tools available by default. Set to `"deny-host-shell"` to hide and reject host `bash`, `pwsh`, and `pwsh_persistent`. |

See [`src/config.ts`](./src/config.ts) and [`cordis.patch.yml`](./cordis.patch.yml) for the complete schema and defaults.

## Compatibility and verification

- **Version**: `0.1.4`
- **Node.js**: `^22.19 || >=24`
- **DSH compatibility**: `0.2.1-rc.2 || 0.2.1-rc.3 || >=0.2.2-rc.1 <0.2.3-0`
  - **Verified**: `0.2.2-rc.1` through `0.2.2-rc.5` were tested with live host components for execution, background jobs, and permission boundaries. `0.2.1-rc.2` and `0.2.1-rc.3` were tested for per-Agent publishing, foreground execution, and tool revocation when switching to read-only without a sandbox.
  - **Policy**: Later RCs and final releases on the `0.2.2` line are admitted by the range; `0.2.3` will require re-verification starting from its prereleases.

For development verification, run from the repository root:

```sh
npm ci --ignore-scripts
npm run verify
npm run typecheck
```

## License and provenance

Licensed under the MIT License; see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE):

- **Direct upstream**: [T-Auto/dsh-ops](https://github.com/T-Auto/dsh-ops) `0.4.1` (commit `dfafddc`, MIT), license text preserved in [`licenses/dsh-ops-LICENSE`](./licenses/dsh-ops-LICENSE).
- **Transitive upstream**: Parts of the tool contract were adapted via `dsh-ops` from `@deepseek-ai/dsh-tool-bash` `0.2.0-rc.2` (MIT), license text preserved in [`licenses/deepseek-harness/LICENSE`](./licenses/deepseek-harness/LICENSE).
- **File-level mapping and changes**: See [`docs/PROVENANCE.md`](./docs/PROVENANCE.md).
- **Windows Bash payload**: Downloaded separately by `node bin/dsh-bash.mjs provision` (Git for Windows PortableGit `2.56.0.2`), not bundled with this repository, and governed by its upstream licenses (including GPL-2.0).