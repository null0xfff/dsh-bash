#!/usr/bin/env node
/**
 * Install the pinned upstream bash payload into this package's own store.
 *
 * Ported from `dsh-ops/src/cli/provision-shells.ts` (MIT, dsh-ops 0.4.1) for the
 * bash rung only: download the pin, verify the archive digest, unpack it with the
 * archive's own self-extractor, verify the executable digest, and record a
 * receipt. Nothing outside `<DSH_HOME>/dsh-bash/shells/bash/<version>` is written
 * except a temporary download directory.
 *
 *   node scripts/provision-bash.mjs [--force] [--dry-run]
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const force = argv.includes('--force')
const dryRun = argv.includes('--dry-run')

const { SHELL_UPSTREAM_PINS, provisionedShellVersionDir } = await import(new URL('../lib/shells.js', import.meta.url))
const pin = SHELL_UPSTREAM_PINS.find(entry => entry.name === 'bash'
  && entry.platform === process.platform && entry.arch === process.arch)
if (pin === undefined) {
  console.error(`provision-bash: no pinned bash for ${process.platform}-${process.arch}`)
  process.exit(1)
}

const target = provisionedShellVersionDir({ kind: 'bash', version: pin.version })
const executable = path.join(target, pin.executableRelativePath)
const receiptFile = path.join(target, '.provisioned.json')

const readReceipt = () => {
  try { return JSON.parse(fs.readFileSync(receiptFile, 'utf8')) } catch { return undefined }
}
const sha256File = file => new Promise((resolve, reject) => {
  const hash = createHash('sha256')
  const stream = fs.createReadStream(file)
  stream.on('data', chunk => hash.update(chunk))
  stream.once('error', reject)
  stream.once('end', () => resolve(hash.digest('hex')))
})

const receipt = readReceipt()
if (!force && receipt?.schemaVersion === 1 && receipt?.version === pin.version
  && receipt?.sha256 === pin.sha256 && fs.existsSync(executable)) {
  console.log(`bash: already provisioned â€?${executable}`)
  console.log(`  version: ${pin.version}`)
  console.log(`  sha256:  ${pin.sha256}`)
  process.exit(0)
}

if (dryRun) {
  console.log(`bash: would provision version ${pin.version} (dry run: no download, no writes)`)
  console.log(`  url:        ${pin.url}`)
  console.log(`  asset:      ${pin.assetFile} (${pin.bytes} bytes)`)
  console.log(`  sha256:     ${pin.sha256}`)
  console.log(`  unpack:     ${pin.extractor} into ${path.resolve(target, pin.extractTo)}`)
  console.log(`  target:     ${target}`)
  console.log(`  executable: ${executable}`)
  process.exit(0)
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bash-'))
const asset = path.join(scratch, pin.assetFile)
try {
  console.log(`bash: downloading ${pin.url}`)
  const response = await fetch(pin.url, { redirect: 'follow' })
  if (!response.ok || response.body === null) {
    throw new Error(`download failed: HTTP ${response.status} ${response.statusText}`)
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(asset))
  const actual = await sha256File(asset)
  if (actual !== pin.sha256) {
    console.error(`bash: ${pin.assetFile} hashed to ${actual}, not the pinned ${pin.sha256}`)
    console.error('  refusing to install bytes this distribution did not pin')
    console.error(`  kept for diagnosis: ${asset}`)
    process.exit(1)
  }
  console.log(`bash: verified sha256 ${actual}`)

  if (force) fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(path.resolve(target, pin.extractTo), { recursive: true })
  // PortableGit's asset IS a 7-Zip self-extractor: `-o<dir>` names where it unpacks,
  // `-y` answers its own prompts.
  const unpacked = spawnSync(asset, [`-o${path.resolve(target, pin.extractTo)}`, '-y'], {
    cwd: scratch, encoding: 'utf8', windowsHide: true,
  })
  if (unpacked.error) throw unpacked.error
  if (unpacked.status !== 0) throw new Error(`self-extractor exited with ${unpacked.status}: ${(unpacked.stderr ?? '').trim()}`)
  if (!fs.existsSync(executable)) throw new Error(`unpacked tree has no ${pin.executableRelativePath}`)
  if (pin.executableSha256 !== undefined) {
    const executableDigest = await sha256File(executable)
    if (executableDigest !== pin.executableSha256) {
      throw new Error(`${pin.executableRelativePath} hashed to ${executableDigest}, not the pinned ${pin.executableSha256}`)
    }
    console.log(`bash: verified ${pin.executableRelativePath} sha256 ${executableDigest}`)
  }
  fs.writeFileSync(receiptFile, `${JSON.stringify({
    schemaVersion: 1,
    name: pin.name,
    version: pin.version,
    shellVersion: pin.version,
    releaseTag: pin.releaseTag,
    url: pin.url,
    assetFile: pin.assetFile,
    sha256: pin.sha256,
    executableRelativePath: pin.executableRelativePath,
    executableSha256: pin.executableSha256,
    provisionedAt: new Date().toISOString(),
  }, null, 2)}\n`)
  console.log(`bash: provisioned ${executable}`)
} catch (error) {
  console.error(`bash: ${error?.message ?? error}`)
  console.error(`  download kept for diagnosis: ${asset}`)
  process.exitCode = 1
} finally {
  fs.rmSync(scratch, { recursive: true, force: true })
}
