#!/usr/bin/env node
/**
 * Test runner: one process per suite, real exit code, optional name filter.
 *
 *   node test/run.mjs            # every suite
 *   node test/run.mjs mount      # suites whose file name contains "mount"
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const here = import.meta.dirname
const filter = process.argv[2]
const files = fs.readdirSync(here)
  .filter(name => name.endsWith('.test.mjs'))
  .filter(name => filter === undefined || name.includes(filter))
  .sort()

if (files.length === 0) {
  console.error(`run: no suites matched ${JSON.stringify(filter ?? '')}`)
  process.exit(2)
}

const totals = { suites: 0, failed: 0 }
const failed = []
for (const file of files) {
  const result = spawnSync(process.execPath, [path.join(here, file)], { stdio: 'inherit' })
  if (result.error) throw result.error
  totals.suites++
  if (result.status !== 0) {
    totals.failed++
    failed.push(file)
  }
}

console.log(totals.failed === 0
  ? `\nALL SUITES PASSED: ${totals.suites}/${totals.suites} suites`
  : `\nSUITE FAILURES: ${totals.failed}/${totals.suites} suites failed`)
if (totals.failed > 0) {
  for (const file of failed) console.log(`  - ${file}`)
  process.exitCode = 1
}
