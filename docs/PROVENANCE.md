# Provenance

`dsh-bash` is a **secondary development** of
[`T-Auto/dsh-ops`](https://github.com/T-Auto/dsh-ops): the bash component of that
plugin, extracted into a standalone DSH plugin. This document records exactly what
came from where, so the derivation is auditable rather than implied.

## Upstream

| Fact | Value |
| --- | --- |
| Project | `T-Auto/dsh-ops` |
| Version read | `0.4.1` |
| Commit read | `dfafddc` (`Merge pull request #403 from T-Auto/work/review-snapshot-356`) |
| License | MIT — Copyright (c) 2026 T-Auto and the dsh-ops contributors |
| License text kept at | `licenses/dsh-ops-LICENSE` |
| Clone used | `git clone --depth 1 https://github.com/T-Auto/dsh-ops.git` |

A second, transitive upstream applies to the host tool contract:
`@deepseek-ai/dsh-tool-bash` 0.2.0-rc.2 (MIT, Copyright (c) 2026 DeepSeek),
which dsh-ops adapted and this package carries. Its license text is kept at
`licenses/deepseek-harness/LICENSE`.

## File-level mapping

Carried over from dsh-ops, with the package identity renamed (`dsh-ops` →
`dsh-bash`) and operator commands repointed at this package's provisioner:

| This package | dsh-ops source | Change |
| --- | --- | --- |
| `src/shells/*.ts` (20 modules) | `src/shells/*.ts` | Identity rename only, except the two below |
| `src/shells/paths.ts` | `src/shells/paths.ts` | Remedy strings point at `node bin/dsh-bash.mjs provision` |
| `src/shells/tool.ts` | `src/shells/tool.ts` | Identity rename only |
| `src/shells/spawn-error.ts` | same | Remedy strings repointed |
| `src/shells/manager.ts` | same | Identity rename, operator command repointed |
| `src/shells/pinned.ts` | same | Identity rename only |
| `src/shells/publish.ts` | same | Identity rename only |
| `src/session-shells.ts` | same | Identity rename only |
| `src/bash-ipc.ts`, `src/bash-pe.ts` | same | Identity rename only |
| `src/workspace-preparation.ts` | same | Identity rename only; `bin/prepare-workspace.ps1` copied verbatim |
| `src/permissions.ts`, `src/tool-changes.ts`, `src/teardown.ts`, `src/paths.ts`, `src/kernel/outcome.ts` | same | Identity rename only |
| `src/surface.ts` | `src/surface.ts` | Reduced to `visibleNames` |
| `native/bash-ipc/*` | same | Copied verbatim (original MIT C++) |
| `bin/prepare-workspace.ps1` | same | Copied verbatim |
| `scripts/build-bash-ipc.mjs` | `bin/build-bash-ipc.mjs` | Reduced to the bash rung, output path unchanged |
| `scripts/provision-bash.mjs` | `src/cli/provision-shells.ts` | Rewritten for bash only: one pin, one receipt, `--force` / `--dry-run` |

## Written for this package

| File | Why it exists |
| --- | --- |
| `src/index.ts` | Bash-only mount: resolve → publish `ops_bash` → prompt section → optional host-shell denial → Windows ACL preparation |
| `src/config.ts` | Shell-row config only; legacy dsh-ops keys accepted and dropped so an upstream row can be copied verbatim |
| `src/policy.ts` | Bash-only routing text (the upstream table also described six file-tool rows) |
| `src/components/shell/index.ts` | Row entry; **deliberately exports no `Config`** (see below) |
| `scripts/build.mjs`, `scripts/validate-manifest.mjs`, `scripts/verify-install.mjs`, `bin/dsh-bash.mjs` | Build, DSH manifest conformance, install check, operator CLI |
| `test/*` (10 suites) | The port's own regression suite: config, resolution, tool contract, execution, mount, policy, workdir, restricted IPC, provisioner, packaging |
| `README.md`, this file, `NOTICE`, `LICENSE`, locale documents | Documentation and attribution |

## Deliberate behavioural differences

- **One component row.** The file, PTC, discovery, panel, TUI and hide-official rows
  are not ported; `dsh-bash` mounts only the shell half.
- **No PowerShell management.** The host keeps owning `pwsh`; this package never
  supplies or overrides its executable.
- **Own store namespace.** Provisioned shells live under
  `<DSH_HOME>/dsh-bash/shells`, and the confined-runtime cache under
  `<DSH_HOME>/dsh-bash/bash-ipc`, so `dsh-ops` and `dsh-bash` can coexist without
  reading each other's state.
- **No `Config` export on the row entry.** The DSH Loader validates a row against
  that export as a schemastery-shaped schema; a plain function there fails
  activation with `Cannot read properties of undefined (reading 'validate')`. The
  validation lives in `apply()` instead, where an invalid row is a normal
  activation failure with this package's own message.
- **ASCII prompt text.** The routing heading uses `->` rather than a Unicode arrow:
  the port must survive a source tree that is re-encoded or read case-insensitively
  by tooling, and a corrupted multi-byte character would reach the model verbatim.
- **Committed `lib/`.** The built output is checked in so a git-installed copy loads
  without a TypeScript toolchain; CI rebuilds it and fails when the committed output
  drifts from `src/`.

## Not included

No FastCtx code, no Rust worker, no PTC SDK: dsh-ops removed FastCtx in 0.3.2 and
this extraction never touched the Rust surface beyond leaving it out. The Windows
bash payload is downloaded from upstream Git for Windows, not redistributed.
