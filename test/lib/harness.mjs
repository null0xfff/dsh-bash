/** Minimal suite harness: one process per file, ordered cases, real exit code. */
export function createSuite(title) {
  const cases = []
  return {
    /**
     * Register one case. Accepts either `test(name, fn, options)` or the
     * `test(name, options, fn)` spelling so a suite can pass `{ skip: ... }`
     * before its body.
     */
    test(name, fnOrOptions, maybeFn) {
      let fn = fnOrOptions
      let options = maybeFn ?? {}
      if (typeof fnOrOptions !== 'function' && typeof maybeFn === 'function') {
        fn = maybeFn
        options = fnOrOptions ?? {}
      }
      if (typeof fn !== 'function') throw new Error(`test ${JSON.stringify(name)} has no body`)
      cases.push({ name, fn, options })
    },
    async run() {
      const started = Date.now()
      let failed = 0
      let skipped = 0
      console.log(`\n# ${title}`)
      for (const { name, fn, options } of cases) {
        if (options.skip === true) {
          skipped++
          console.log(`  skip ${name}${options.skipReason === undefined ? '' : ` — ${options.skipReason}`}`)
          continue
        }
        try {
          await fn()
          console.log(`  ok   ${name}`)
        } catch (error) {
          failed++
          console.log(`  FAIL ${name}\n         ${String(error?.stack ?? error).split('\n').slice(0, 6).join('\n         ')}`)
        }
      }
      const passed = cases.length - failed - skipped
      const elapsed = Date.now() - started
      console.log(`${failed === 0 ? 'PASS' : 'FAIL'} ${title}: ${passed}/${cases.length - skipped} in ${elapsed}ms${skipped ? ` (${skipped} skipped)` : ''}`)
      process.exitCode = failed === 0 ? 0 : 1
      return { passed, total: cases.length - skipped, skipped }
    },
  }
}
