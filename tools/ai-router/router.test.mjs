import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import test from 'node:test'

const expectedArgs = {
  codex: ['--ask-for-approval', 'never', 'exec', '--sandbox', 'read-only', '--json', '-'],
  claude: ['-p', 'Follow the provided task', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'plan'],
  dsh: ['--profile', 'headless', '--permission-mode', 'read-only', '--approval-policy', 'never', '--json', '-'],
}

function fixture(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'LO-OPS-001-router-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const toolDir = join(root, 'copied router')
  const cwd = join(root, 'calling project')
  mkdirSync(toolDir)
  mkdirSync(cwd)
  const task = Buffer.from('# 中文任务\r\n\r\n保留 `echo ${HOME}` 与 $(touch unexpected); & | >\n\n')
  writeFileSync(join(cwd, 'task file.md'), task)
  return {
    cwd,
    task,
    setupTool() {
      for (const name of ['router.mjs', 'profiles.example.json']) {
        copyFileSync(new URL(name, import.meta.url), join(toolDir, name))
      }
    },
    config(profiles) {
      writeFileSync(join(cwd, 'my profiles.json'), JSON.stringify(profiles))
      return 'my profiles.json'
    },
    fakeCLI(name) {
      const path = join(toolDir, name)
      // Exercise actual OS process and pipe behavior without using any provider account.
      writeFileSync(path, `#!/usr/bin/env node
const fs = require('node:fs')
const input = fs.readFileSync(0)
process.stdout.write(JSON.stringify({
  args: process.argv.slice(2),
  cwd: process.cwd(),
  input: input.toString('base64'),
}) + '\\n')
process.stderr.write('provider diagnostic\\n')
process.exitCode = 7
`, { mode: 0o755 })
      return path
    },
    invoke(...args) {
      return spawnSync(process.execPath, [join(toolDir, 'router.mjs'), ...args], {
        cwd,
        encoding: 'utf8',
        env: { PATH: [dirname(process.execPath), toolDir].join(delimiter) },
        timeout: 5000,
      })
    },
  }
}

test('plan uses the copied defaults alongside the launcher and hashes the calling project task', (t) => {
  const project = fixture(t)
  project.setupTool()
  for (const [provider, args] of Object.entries(expectedArgs)) {
    const result = project.invoke('plan', provider, 'task file.md')
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'planned',
      profile: provider,
      requested: { provider },
      argv: [provider, ...args],
      cwd: project.cwd,
      taskSha256: createHash('sha256').update(project.task).digest('hex'),
    })
  }
})

test('run forwards exact bytes, native argv, cwd and both output streams from an executable stand-in', {
  skip: process.platform === 'win32' && 'uses POSIX executable scripts as stand-ins',
}, (t) => {
  const project = fixture(t)
  project.setupTool()
  for (const [provider, args] of Object.entries(expectedArgs)) {
    const binary = project.fakeCLI('native ' + provider)
    const config = project.config({ local: { provider, binary } })
    const result = project.invoke('run', 'local', 'task file.md', config)
    assert.equal(result.status, 7, result.stderr)
    assert.equal(result.stderr, 'provider diagnostic\n')
    assert.deepEqual(JSON.parse(result.stdout), {
      args,
      cwd: project.cwd,
      input: project.task.toString('base64'),
    })
  }
  project.fakeCLI('codex')
  assert.equal(project.invoke('run', 'codex', 'task file.md').status, 7)
})

test('plan represents Codex and Claude settings as requests and emits one native argument per value', (t) => {
  const project = fixture(t)
  project.setupTool()
  const profiles = {
    analysis: { provider: 'codex', model: 'gpt-example', effort: 'high' },
    drafting: { provider: 'claude', model: 'sonnet[1m]', effort: 'medium' },
  }
  const config = project.config(profiles)
  const codex = project.invoke('plan', 'analysis', 'task file.md', config)
  assert.equal(codex.status, 0, codex.stderr)
  const codexPlan = JSON.parse(codex.stdout)
  assert.deepEqual(codexPlan.requested, profiles.analysis)
  assert.deepEqual(codexPlan.argv, [
    'codex', ...expectedArgs.codex.slice(0, -1),
    '--model', 'gpt-example', '--config', 'model_reasoning_effort="high"', '-',
  ])
  const claude = project.invoke('plan', 'drafting', 'task file.md', config)
  assert.equal(claude.status, 0, claude.stderr)
  const claudePlan = JSON.parse(claude.stdout)
  assert.deepEqual(claudePlan.requested, profiles.drafting)
  assert.deepEqual(claudePlan.argv, [
    'claude', ...expectedArgs.claude, '--model', 'sonnet[1m]', '--effort', 'medium',
  ])
})

test('Codex can request the higher effort levels advertised by the native client', (t) => {
  const project = fixture(t)
  project.setupTool()
  for (const effort of ['max', 'ultra']) {
    const config = project.config({ local: { provider: 'codex', effort } })
    const result = project.invoke('plan', 'local', 'task file.md', config)
    assert.equal(result.status, 0, result.stderr)
    assert.ok(JSON.parse(result.stdout).argv.includes(`model_reasoning_effort="${effort}"`))
  }
})

test('edit opts into each provider’s ordinary editing policy', (t) => {
  const project = fixture(t)
  project.setupTool()
  for (const [provider, args] of Object.entries(expectedArgs)) {
    const requested = { provider, access: 'edit' }
    const config = project.config({ local: requested })
    const result = project.invoke('plan', 'local', 'task file.md', config)
    assert.equal(result.status, 0, result.stderr)
    const plan = JSON.parse(result.stdout)
    assert.deepEqual(plan.requested, requested)
    assert.deepEqual(plan.argv, [
      provider,
      ...args.map((arg) => arg === 'read-only' ? 'workspace-write' : arg === 'plan' ? 'acceptEdits' : arg),
    ])
  }
})

test('invalid inputs fail before a child can run', (t) => {
  const project = fixture(t)
  project.setupTool()
  const cases = [
    [[], /profile map/],
    [{}, /unknown profile/],
    [{ local: null }, /profile object/],
    [{ local: { provider: 'toString' } }, /unsupported provider/],
    [{ local: { provider: 'codex', args: ['--dangerously-bypass-approvals-and-sandbox'] } }, /unknown field/],
    [{ local: { provider: 'codex', binary: './local' } }, /binary/],
    [{ local: { provider: 'codex', binary: 'codex --help' } }, /binary/],
    [{ local: { provider: 'codex', model: '--config' } }, /model/],
    [{ local: { provider: 'codex', effort: 'fast' } }, /effort/],
    [{ local: { provider: 'codex', access: 'full' } }, /access/],
    [{ local: { provider: 'claude', effort: null } }, /effort/],
    [{ local: { provider: 'dsh', effort: 'high' } }, /effort/],
    [{ local: { provider: 'dsh', model: 'deepseek-example' } }, /model/],
  ]
  for (const [profiles, error] of cases) {
    const result = project.invoke('run', 'local', 'task file.md', project.config(profiles))
    assert.equal(result.status, 1, result.stderr)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, error)
  }
  writeFileSync(join(project.cwd, 'bad.json'), '{ invalid')
  const badConfig = project.invoke('run', 'codex', 'task file.md', 'bad.json')
  assert.equal(badConfig.status, 1)
  assert.match(badConfig.stderr, /invalid JSON/)
  writeFileSync(join(project.cwd, 'empty.md'), '\r\n \t')
  const emptyTask = project.invoke('run', 'codex', 'empty.md')
  assert.equal(emptyTask.status, 1)
  assert.match(emptyTask.stderr, /empty task/)
})

test('run reports a missing executable without provider output', (t) => {
  const project = fixture(t)
  project.setupTool()
  const binary = join(project.cwd, 'missing-native-cli')
  const config = project.config({ local: { provider: 'codex', binary } })
  const result = project.invoke('run', 'local', 'task file.md', config)
  assert.equal(result.status, 127, result.stderr)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /executable not found/)
})
