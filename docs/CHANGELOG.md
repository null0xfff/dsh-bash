# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- `resolveShells` takes an optional `probe` for the well-known install locations. Production
  passes none and the real filesystem answers; a caller resolving against a host other than its
  own can name that answer, which is what makes both ends of that rung testable on one machine.

### Fixed

- The suites no longer encode the host they were written on: the managed bash selection names the
  win32 pin it resolves against (and proves the POSIX refusal with a win32-shaped store present),
  the POSIX remedy case pins the well-known answer instead of accepting either one, and the
  capture-truncation case skips where no bash can run instead of failing.

## [0.1.2] - 2026-11-13

### Changed

- Add DSH `0.2.2-rc.3` to both `engines.dsh` and the optional DSH peer range, preserving
  the previously declared `0.2.1-rc.2`, `0.2.1-rc.3`, and `0.2.2-rc.1` support. Keep exact
  prerelease entries rather than admitting unverified RCs or stable releases.
- Build and typecheck against DSH `0.2.2-rc.3` packages; regenerate the lockfile with a
  consistent rc.3 dependency graph. Runtime execution, sandbox, approval and job semantics
  are unchanged.
- Bump the package and community manifest together to `0.1.2`.

### Added

- Packaging regressions using the host's `semver.satisfies(..., { includePrerelease: true })`
  options: accept all declared host versions, reject unverified releases, and require the
  package/lockfile versions, host gates and rc.3 type dependencies to stay in sync.

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
