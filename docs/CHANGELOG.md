# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-26

### Added

- Standalone DSH plugin packaging: `dsh-plugin.json` manifest v0.15, one bundle row
  (`dsh-bash-shell`), `./shell` component export, display icon and `en`/`zh` locale
  documents, tool namespace `dsh-bash` publishing `ops_bash`.
- `ops_bash` over the plugin's resolved bash: argument contract, output schema,
  host result rendering, background job handoff, sandbox-policy enforcement,
  caller cancellation, spill-aware truncation.
- Bash resolution ladder: `bashPath` → provisioned store → bundled/vendored copy →
  opt-in `PATH` / well-known installs, with the WSL `bash.exe` launcher excluded.
- Pinned bash provisioning (`node bin/dsh-bash.mjs provision`) with archive and
  executable digest verification plus an ownership receipt.
- Windows confined-mode gate (`src/bash-ipc.ts`): MSYS payload layout check,
  provenance receipt check, quarantining of unverifiable runtime generations, and a
  local IPC proxy build script (`scripts/build-bash-ipc.mjs`, needs MSVC).
- Windows workspace ACL preparation before confined execution.
- Optional `deny-host-shell` policy that hides and refuses the host's own shell tools.
- Ten test suites (144 cases) driven by `test/run.mjs`, plus `scripts/validate-manifest.mjs`
  and `scripts/verify-install.mjs`.
- Documentation: README (Chinese), `docs/PROVENANCE.md`, `NOTICE`, third-party license texts.

### Changed

- Reduced the extracted bash component to its own package identity: store paths,
  config section name, and operator commands all read `dsh-bash`.
