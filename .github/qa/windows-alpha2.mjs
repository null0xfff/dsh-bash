import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';

const runtime = '0.2.3-alpha.2';
const pluginVersion = '0.1.4';
const sourceRevision = 'aab9e12217784b8074c09100b5692130f29dd62c';
const originRange = '0.2.1-rc.2 || 0.2.1-rc.3 || >=0.2.2-rc.1 <0.2.3-0';
const expected = {
  tag: 'v2.56.1.windows.1',
  url: 'https://github.com/git-for-windows/git/releases/download/v2.56.1.windows.1/PortableGit-2.56.1-64-bit.7z.exe',
  archive: '9dd04a608ceb5f6ab32a73709e0ecb159d211da71b697c45ff81f6dd0c6b49c7',
  bash: '1f654b9227b44acae4d388daa44564624adf42c48cd29373645a9fcde9fc7f99',
};
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const normalize = value => value.replaceAll('\\', '/').toLowerCase();

function declare(source) {
  const file = path.join(source, 'package.json');
  const raw = fs.readFileSync(file, 'utf8');
  const old = JSON.parse(raw);
  assert.equal(old.version, pluginVersion);
  assert.equal(old.engines.dsh, originRange);
  assert.equal(old.peerDependencies['@deepseek-ai/dsh'], originRange);
  assert.equal(old.peerDependenciesMeta['@deepseek-ai/dsh'].optional, true);
  const exact = JSON.stringify(originRange);
  assert.equal(raw.split(exact).length, 3);
  const updated = originRange + ' || ' + runtime;
  const next = raw.replaceAll(exact, JSON.stringify(updated));
  old.engines.dsh = updated;
  old.peerDependencies['@deepseek-ai/dsh'] = updated;
  assert.deepEqual(JSON.parse(next), old);
  fs.writeFileSync(file, next);
}

function stdoutFor(file, args, { env, cwd, step, timeout = 240000 }) {
  console.log('CHECK:', step);
  const child = spawnSync(file, args, { cwd, env, encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 });
  if (child.stdout?.trim()) console.log(child.stdout.trim());
  if (child.stderr?.trim()) console.error(child.stderr.trim());
  if (child.error) throw child.error;
  assert.equal(child.status, 0, step + ' failed: ' + String(child.signal ?? child.status));
  return child.stdout;
}

async function headless(cli, work, home, env) {
  const marker = 'QA_WINDOWS_CONFINED_42091';
  const command = 'p=$(/usr/bin/cygpath.exe -aw "$BASH") && printf "QA_BASH=%s\\n" "$p" && cat witness.txt && printf "%s\\n" ' + marker + ' > workspace-output.txt && cat workspace-output.txt';
  fs.writeFileSync(path.join(work, 'witness.txt'), 'QA_WINDOWS_READ_18678\n');
  let offered = false, invoked = false, resultReturned = false;
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
        res.writeHead(404).end();
        return;
      }
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 2_000_000) throw Error('Unexpected request size'); }
      const p = JSON.parse(raw);
      assert.equal(p.model, 'smoke');
      const canCall = (p.tools ?? []).some(t => t.function?.name === 'ops_bash');
      offered ||= canCall;
      const toolResult = (p.messages ?? []).findLast(m => m.role === 'tool' && m.tool_call_id === 'call_qa_windows');
      resultReturned ||= Boolean(toolResult);
      const call = canCall && !invoked;
      invoked ||= call;
      const chunk = (delta, finish_reason = null) => ({id:'qa-win', object:'chat.completion.chunk', created:1, model:'smoke', choices:[{index:0, delta, finish_reason}]});
      res.writeHead(200, {'Content-Type': 'text/event-stream'});
      for (const x of [
        chunk({role: 'assistant'}),
        call ? chunk({tool_calls: [{index:0, id:'call_qa_windows', type:'function', function:{name:'ops_bash', arguments:JSON.stringify({command, description:'Verify pinned Bash in the confined QA workspace'})}}]}) : chunk({content:'QA_HEADLESS_FINAL'}),
        chunk({}, call ? 'tool_calls' : 'stop'),
      ]) res.write('data: ' + JSON.stringify(x) + '\n\n');
      res.end('data: [DONE]\n\n');
    } catch (e) {
      console.error(e.message);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const patch = path.join(home, 'qa-model.yml');
  fs.writeFileSync(patch, [
    '- id: llm-pi-ai', '  config:', '    providers:', '      qa-loopback:', '        api: openai-completions',
    '        baseURL: http://127.0.0.1:' + server.address().port + '/v1',
    '        apiKeyEnv: DSH_QA_LOCAL_PLACEHOLDER', '        models:', '          - id: smoke',
    '- id: agent-default-model', '  config:', '    provider: qa-loopback', '    model: smoke',
  ].join('\n') + '\n');
  const cp = spawn(process.execPath, [cli, '--profile', 'headless', '--patch', patch, '--json', '--permission-mode', 'workspace-write', '--approval-policy', 'never', 'Execute the deterministic Windows QA smoke test'], { cwd:work, env:{...env, DSH_QA_LOCAL_PLACEHOLDER:'loopback-only-not-a-secret'}, windowsHide:true, stdio:['ignore','pipe','pipe'] });
  let out = '', err = '';
  cp.stdout.setEncoding('utf8').on('data', d => {out += d;});
  cp.stderr.setEncoding('utf8').on('data', d => {err += d;});
  const watchdog = setTimeout(() => cp.kill(), 120000);
  let exit;
  try { exit = await new Promise((resolve, reject) => cp.once('error', reject).once('close', resolve)); }
  finally { clearTimeout(watchdog); server.closeAllConnections(); server.close(); }
  console.log('CHECK: actual headless workspace-write tools');
  console.log(out.trim());
  if (err.trim()) console.error(err.trim());
  assert.equal(exit, 0);
  const events = out.trim().split(/\r?\n/).flatMap(line => {try {return [JSON.parse(line)];} catch {return [];}});
  const call = events.find(e => e.type === 'tool_call' && e.callId === 'call_qa_windows');
  const result = events.find(e => e.type === 'tool_result' && e.callId === 'call_qa_windows');
  const final = events.findLast(e => e.type === 'final');
  assert(offered && invoked && resultReturned, 'Missing loopback advertisement, call or returned tool result');
  assert.equal(call?.tool, 'ops_bash');
  assert.equal(result?.status, 'completed');
  assert.match(result?.result ?? '', /QA_WINDOWS_READ_18678[\s\S]*QA_WINDOWS_CONFINED_42091[\s\S]*\[exit code: 0\]/);
  assert.equal(final?.reason?.kind, 'completed');
  assert.equal(final?.text, 'QA_HEADLESS_FINAL');
  assert.equal(fs.readFileSync(path.join(work, 'workspace-output.txt'), 'utf8').trim(), marker);
  return /^QA_BASH=(.+)$/m.exec(result.result)?.[1]?.trim();
}

async function run(root) {
  assert.equal(process.platform, 'win32');
  assert.equal(process.arch, 'x64');
  assert.equal(process.version, 'v24.22.3');
  const home = path.join(root, 'home');
  const work = path.join(root, 'work');
  const host = path.join(root, 'host');
  const hostModules = path.join(host, 'node_modules');
  const cli = path.join(hostModules, '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  assert.equal(json(path.join(hostModules, '@deepseek-ai', 'dsh', 'package.json')).version, runtime);
  assert.equal(json(path.join(hostModules, '@deepseek-ai', 'cordis-plugin-loader', 'package.json')).version, '1.2.0-alpha.1');
  const aclRunner = path.join(hostModules, '@deepseek-ai', 'dsh-sandbox-windows-acl', 'lib', 'runner.js');
  assert(fs.existsSync(aclRunner), 'Published Windows ACL runner missing');
  assert.equal(typeof createRequire(aclRunner)('koffi').load, 'function', 'Windows native koffi could not load');
  console.log('CHECK: stock Windows ACL runner and native FFI loaded');
  const packageTar = path.join(root, 'packs', 'dsh-bash-' + pluginVersion + '.tgz');
  const keep = /^(?:path|systemroot|windir|comspec|pathext|programfiles(?:\(x86\))?|programw6432|systemdrive|userprofile|username|userdomain|appdata|localappdata|number_of_processors|processor_architecture|processor_identifier|homedrive|homepath|commonprogramfiles(?:\(x86\))?|programdata)$/i;
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => keep.test(name)));
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'Path';
  env[pathKey] = path.join(hostModules, '.bin') + path.delimiter + (env[pathKey] ?? '');
  const temp = path.join(root, 'temp');
  fs.mkdirSync(temp);
  Object.assign(env, {
    TEMP:temp, TMP:temp, DSH_HOME:home, DSH_TELEMETRY_DISABLED:'1', NO_PROXY:'127.0.0.1,localhost',
    npm_config_cache:path.join(root, 'npm-cache'), npm_config_registry:'https://registry.npmjs.org/',
    GIT_CONFIG_NOSYSTEM:'1', GIT_CONFIG_GLOBAL:'NUL',
  });
  const node = (args, step, timeout) => stdoutFor(process.execPath, args, {env,cwd:work,step,timeout});
  assert.equal(node([cli, '--version'], 'stock official npm runtime').trim(), runtime);
  assert.match(node([cli, '--profile', 'headless', '--help'], 'stock headless profile boot'), /--permission-mode/);
  node([cli, 'plugin', '--profile', 'headless', 'add', '--store-dir', path.join(root, 'pnpm-store'), packageTar], 'install declaration-only tarball with DSH plugin add');
  const profile = path.join(home, 'profiles', 'headless');
  assert(json(path.join(profile, 'package.json')).dsh.profile.bundles.includes('dsh-bash'));
  const installed = fs.realpathSync(path.join(profile, 'node_modules', 'dsh-bash'));
  const metadata = json(path.join(installed, 'package.json'));
  assert.equal(metadata.engines.dsh, originRange + ' || ' + runtime);
  assert.equal(metadata.peerDependencies['@deepseek-ai/dsh'], originRange + ' || ' + runtime);
  const entry = path.join(installed, 'bin', 'dsh-bash.mjs');
  node([entry, 'provision'], 'download and verify official PortableGit, then provision');
  const portable = path.join(home, 'dsh-bash', 'shells', 'bash', '2.56.1');
  const bash = path.join(portable, 'bin', 'bash.exe');
  const msys = path.join(portable, 'usr', 'bin', 'msys-2.0.dll');
  const received = json(path.join(portable, '.provisioned.json'));
  assert.equal(received.schemaVersion, 1);
  assert.equal(received.name, 'bash');
  assert.equal(received.version, '2.56.1');
  assert.equal(received.releaseTag, expected.tag);
  assert.equal(received.url, expected.url);
  assert.equal(received.sha256, expected.archive);
  assert.equal(received.executableRelativePath, 'bin/bash.exe');
  assert.equal(received.executableSha256, expected.bash);
  assert.equal(sha(bash), expected.bash);
  const gitVersion = stdoutFor(path.join(portable, 'cmd', 'git.exe'), ['--version'], {env,cwd:work,step:'explicit provisioned Git executable'});
  assert.equal(gitVersion.trim(), 'git version 2.56.1.windows.1');
  const pre = node([entry, 'status'], 'before IPC build (must not claim restricted ready)');
  assert.match(pre, /source:\s+provisioned/);
  assert(normalize(pre).includes(normalize(bash)));
  assert.match(pre, /restricted modes: unavailable/);
  node([entry, 'build-ipc'], 'native build against exact installed copy');
  const ipc = path.join(installed, 'runtime', 'win32-x64', 'bash-ipc');
  const receipt = json(path.join(ipc, 'provenance.json'));
  assert.equal(receipt.version, 1);
  assert.equal(receipt.platform, 'win32-x64');
  assert.equal(receipt.msysSha256, sha(msys));
  for (const name of ['opsipc.dll', 'opsnt.dll']) assert.equal(sha(path.join(ipc, name)), receipt.files[name]);
  const after = node([entry, 'status'], 'selected managed Bash and compatible IPC receipt');
  assert.match(after, /source:\s+provisioned/);
  assert(normalize(after).includes(normalize(bash)));
  assert.match(after, /restricted modes: compatible/);
  const selectedBash = await headless(cli, work, home, env);
  assert(selectedBash, 'Confined tool output did not identify Bash');
  const privateHome = path.join(home, 'dsh-bash', 'bash-ipc');
  const generation = fs.readdirSync(privateHome).filter(n => /^[a-f\d]{24}$/.test(n));
  assert.equal(generation.length, 1, 'Expected one staged private generation');
  const selected = path.join(privateHome, generation[0]);
  const generationReceipt = json(path.join(selected, '.ops-ipc.json'));
  assert.equal(generationReceipt.identity, generation[0]);
  assert.equal(normalize(generationReceipt.source), normalize(portable));
  assert.equal(generationReceipt.msys, sha(msys));
  const privateBin = path.join(selected, 'usr', 'bin');
  assert.equal(generationReceipt.patchedSha256, sha(path.join(privateBin, 'msys-2.0.dll')));
  assert.notEqual(generationReceipt.patchedSha256, sha(msys));
  for (const name of ['opsipc.dll', 'opsnt.dll']) {
    assert.equal(generationReceipt.files[name], receipt.files[name]);
    assert.equal(sha(path.join(privateBin, name)), receipt.files[name]);
  }
  assert(normalize(selectedBash).match(new RegExp('/dsh-bash/bash-ipc/' + generation[0] + '/usr/bin/bash(?:[.]exe)?$')), 'Tool Bash was not the verified private generation: ' + selectedBash);
  console.log(JSON.stringify({
    result: 'PASS', sourceRevision, node:process.version, host:runtime, arch:process.arch, mode:'workspace-write',
    tarSha256:sha(packageTar), git:gitVersion.trim(), archiveSha256:received.sha256, bashSha256:sha(bash),
    sourceMsysSha256:receipt.msysSha256, patchedMsysSha256:generationReceipt.patchedSha256,
    proxies:receipt.files, privateBash:selectedBash, wroteFixture:true,
  }, null, 2));
}

const [command, target] = process.argv.slice(2);
assert(target && path.isAbsolute(target));
if (command === 'declare') declare(target);
else if (command === 'run') await run(target);
else throw Error('Expected declare/run');
