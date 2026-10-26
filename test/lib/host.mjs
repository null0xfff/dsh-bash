/**
 * Host stand-ins the suites share.
 *
 * The production code reaches every host capability through `ctx.get(...)` or an
 * injected service, so these objects implement only the shapes the mounted code
 * actually reads. A change in what it reads therefore fails a suite instead of
 * drifting silently.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * A subprocess service with the host's observable semantics: closed stdin, bounded
 * per-stream capture with an honest `lossy` flag and a spill file, and signal
 * driven termination.
 */
export function createSubprocess({ maxBytes = 64_000, spill = true } = {}) {
  const spillDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bash-spill-'))
  return {
    spillDir,
    spawn({ argv, cwd, stdio, signal, env }) {
      const child = spawn(argv[0], argv.slice(1), { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      child.stdin.end(stdio?.stdin?.data ?? '')
      const limit = Math.min(stdio?.stdout?.maxBytes ?? Number.POSITIVE_INFINITY, maxBytes)
      const state = { stdout: { text: '', total: 0, lossy: false, spillPath: undefined }, stderr: { text: '', total: 0, lossy: false, spillPath: undefined } }
      for (const name of ['stdout', 'stderr']) {
        child[name].on('data', (chunk) => {
          const text = chunk.toString()
          state[name].total += text.length
          if (state[name].text.length < limit) {
            state[name].text = (state[name].text + text).slice(0, limit)
            if (state[name].total > limit && state[name].text.length === limit) state[name].lossy = true
          } else {
            state[name].lossy = true
          }
          if (state[name].lossy && spill && state[name].spillPath === undefined) {
            const file = path.join(spillDir, `${name}-${process.pid}-${Date.now()}.log`)
            state[name].spillPath = file
            fs.writeFileSync(file, text)
          } else if (state[name].spillPath !== undefined) {
            fs.appendFileSync(state[name].spillPath, text)
          }
        })
      }
      // Kill the whole tree: a shell that forked a grandchild must not keep the pipes open
      // while the executor waits for settlement (the real host uses a job object for this).
      const kill = () => {
        if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        else { try { child.kill('SIGKILL') } catch {} }
        try { child.kill('SIGKILL') } catch {}
      }
      if (signal) signal.addEventListener('abort', kill, { once: true })
      const done = new Promise((resolve, reject) => {
        child.once('error', error => reject(error))
        child.once('close', (code, sig) => resolve({ exitCode: code, signal: sig }))
      })
      const reader = name => ({
        readFrom: offset => ({
          text: state[name].text.slice(offset),
          nextOffset: state[name].text.length,
          lossy: state[name].lossy,
          ...(state[name].spillPath === undefined ? {} : { spillPath: state[name].spillPath }),
        }),
      })
      return { done, collected: { stdout: reader('stdout'), stderr: reader('stderr') }, kill }
    },
  }
}

/** A Cordis-shaped context with the services the bash component borrows. */
export function createHost({
  mode = 'danger-full-access',
  workspaceRoot = process.cwd(),
  confine = true,
  subprocess = createSubprocess(),
  approvalOutcome = 'allowed-once',
  jobs = undefined,
} = {}) {
  const registrations = []
  const restrictions = []
  const sections = []
  const effects = []
  const handlers = new Map()
  const on = (event, handler) => {
    const list = handlers.get(event) ?? []
    list.push(handler)
    handlers.set(event, list)
    return () => {}
  }
  const state = { mode, workspaceRoot, confine }
  const authority = () => ({ mode: state.mode, workspaceRoot: state.workspaceRoot })

  const services = {
    subprocess,
    sandboxPolicy: { resolve: () => authority() },
    sandbox: {
      confine: async (argv, policy) => {
        if (state.confine === false) throw new Error('SANDBOX_UNAVAILABLE')
        return { argv, enforcement: 'full' }
      },
    },
    systemPrompt: {
      section(spec) { sections.push(spec); return () => {} },
      assemble() { return [] },
    },
    approval: {
      request: async () => approvalOutcome,
    },
  }
  if (jobs !== undefined) services.jobs = jobs

  const tools = {
    register(definition) {
      registrations.push(definition)
      return () => {
        const index = registrations.indexOf(definition)
        if (index >= 0) registrations.splice(index, 1)
      }
    },
    restrict(spec) { restrictions.push(spec); return () => {} },
    get(name, scope) {
      if (scope === undefined) return registrations.find(definition => definition.name === name)
      return (scope.registrations ?? registrations).find(definition => definition.name === name)
    },
    schemas() { return registrations.map(definition => ({ name: definition.name, parameters: definition.parameters })) },
    view(scope) {
      const list = scope?.registrations ?? registrations
      return { visible: { keys: () => list.map(definition => definition.name) } }
    },
    guard() { return () => {} },
    guarded: [],
  }

  const childCtx = {
    tools,
    inject: (_names, fn) => fn(childCtx),
    get: name => (name === 'tools' ? tools : services[name]),
    effect: (fn) => { effects.push(fn()); return () => {} },
    on,
    logger: { warn() {}, info() {}, error() {} },
  }

  const ctx = {
    ...childCtx,
    get(name) {
      if (name === 'tools') return tools
      if (name === 'agents') return { list: () => [] }
      return services[name]
    },
    inject(names, fn) {
      if (names.every(name => (name === 'tools' ? true : services[name] !== undefined))) fn(ctx)
      return () => {}
    },
    effect(fn) { effects.push(fn()); return () => {} },
    on,
  }
  Object.assign(ctx, services)

  const makeAgent = (session = { id: 'session-test', header: { cwd: workspaceRoot } }) => {
    const agentRegistrations = []
    const agentTools = {
      ...tools,
      register(definition) {
        agentRegistrations.push(definition)
        registrations.push(definition)
        return () => {
          for (const list of [agentRegistrations, registrations]) {
            const index = list.indexOf(definition)
            if (index >= 0) list.splice(index, 1)
          }
        }
      },
      schemas() { return agentRegistrations.map(definition => ({ name: definition.name, parameters: definition.parameters })) },
      view() { return { visible: { keys: () => agentRegistrations.map(definition => definition.name) } } },
    }
    const agent = {
      session,
      registrations: agentRegistrations,
      ctx: {
        plugin(callback) {
          callback({ inject: (_names, fn) => fn({ ...childCtx, tools: agentTools }) })
          return { dispose: async () => {} }
        },
        tools: agentTools,
      },
    }
    return agent
  }

  return {
    ctx,
    tools,
    registrations,
    restrictions,
    sections,
    effects,
    handlers,
    services,
    state,
    subprocess,
    makeAgent,
    /**
     * Deliver one host event to every registered handler, in registration order, and
     * await each answer. The last non-undefined answer is returned, which is how a
     * refusal reaches the caller while every other handler still runs.
     */
    async emit(event, ...args) {
      let answer
      for (const handler of handlers.get(event) ?? []) {
        const result = await handler(...args)
        if (result !== undefined) answer = result
      }
      return answer
    },
    setMode(next) { state.mode = next },
    setConfine(next) { state.confine = next },
    removeService(name) { delete services[name] },
  }
}

/** A temporary DSH_HOME with the store layout this package reads. */
export function createHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bash-home-'))
  return {
    home,
    store(kind, version, relativePath = 'bin/bash.exe') {
      const directory = path.join(home, 'dsh-bash', 'shells', kind, version)
      fs.mkdirSync(path.dirname(path.join(directory, relativePath)), { recursive: true })
      fs.writeFileSync(path.join(directory, relativePath), 'fake shell payload\n')
      return { directory, executable: path.join(directory, relativePath) }
    },
    receipt(directory, version, sha256 = 'a'.repeat(64)) {
      fs.writeFileSync(path.join(directory, '.provisioned.json'), JSON.stringify({ schemaVersion: 1, name: 'bash', version, sha256 }))
    },
    env(extra = {}) { return { ...process.env, DSH_HOME: home, ...extra } },
    cleanup() { fs.rmSync(home, { recursive: true, force: true }) },
  }
}
