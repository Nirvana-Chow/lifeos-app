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

function fixture(t, systemPath = '') {
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
    writeTask(body) {
      writeFileSync(join(cwd, 'auto task.md'), body)
      return 'auto task.md'
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
        env: {
          PATH: [dirname(process.execPath), toolDir, systemPath].filter(Boolean).join(delimiter),
          GIT_CONFIG_GLOBAL: join(root, 'no-global-config'),
          GIT_CONFIG_NOSYSTEM: '1',
        },
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

test('auto modes run Git locally for an exact status request', (t) => {
  const project = fixture(t, process.env.PATH)
  project.setupTool()
  const init = spawnSync('git', ['init', '--initial-branch=router-status-test'], {
    cwd: project.cwd, encoding: 'utf8', timeout: 5000,
  })
  assert.equal(init.status, 0, init.stderr)
  const config = project.config({
    named: { provider: 'dsh', binary: join(project.cwd, 'missing-provider') },
  })
  for (const request of ['git status\r\n', '查看 Git 状态']) {
    const task = project.writeTask(request)
    const preview = project.invoke('auto-plan', 'named', task, config)
    assert.equal(preview.status, 0, preview.stderr)
    const plan = JSON.parse(preview.stdout)
    assert.equal(plan.tier, 'L0')
    assert.equal(plan.target, 'local')
    assert.ok(plan.reason)
    assert.equal(plan.requested.provider, 'dsh')
    assert.deepEqual(plan.argv, ['git', '--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false', 'status'])

    const outcome = project.invoke('auto-run', 'named', task, config)
    assert.equal(outcome.status, 0, outcome.stderr)
    assert.match(outcome.stdout, /router-status-test/)
    assert.match(outcome.stdout, /auto task\.md/)
  }
})

test('auto-run preserves real Git diff check failure without launching a provider', (t) => {
  const project = fixture(t, process.env.PATH)
  project.setupTool()
  function git(...args) {
    return spawnSync('git', args, { cwd: project.cwd, encoding: 'utf8', timeout: 5000 })
  }
  const init = git('init')
  assert.equal(init.status, 0, init.stderr)
  writeFileSync(join(project.cwd, 'sample.txt'), 'before\n')
  const add = git('add', 'sample.txt')
  assert.equal(add.status, 0, add.stderr)
  writeFileSync(join(project.cwd, 'sample.txt'), 'after \n')
  const task = project.writeTask('git diff --check')
  const config = project.config({ named: { provider: 'codex', binary: join(project.cwd, 'missing-provider') } })
  const preview = project.invoke('auto-plan', 'named', task, config)
  assert.equal(preview.status, 0, preview.stderr)
  const plan = JSON.parse(preview.stdout)
  assert.equal(plan.tier, 'L0')
  assert.deepEqual(plan.argv, [
    'git', '--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false', 'diff', '--no-ext-diff', '--no-textconv', '--check',
  ])

  const outcome = project.invoke('auto-run', 'named', task, config)
  assert.equal(outcome.status, git('diff', '--check').status)
  assert.notEqual(outcome.status, 0)
  assert.match(outcome.stdout, /sample.txt:1: trailing whitespace/)
})

test('Git auto-run defers when external filters are configured or config inspection fails', (t) => {
  const project = fixture(t, process.env.PATH)
  project.setupTool()
  function git(...args) {
    return spawnSync('git', args, { cwd: project.cwd, encoding: 'utf8', timeout: 5000 })
  }
  const init = git('init')
  assert.equal(init.status, 0, init.stderr)

  function assertDeferred(request) {
    const task = project.writeTask(request)
    const outcome = project.invoke('auto-run', 'codex', task)
    assert.equal(outcome.status, 2, outcome.stderr)
    assert.equal(outcome.stdout, '')
    assert.match(outcome.stderr, /Git filter configuration.*run.*directly.*trusted project.*no model/i)
  }

  const addFilter = git('config', 'filter.fixture.clean', 'fixture-filter')
  assert.equal(addFilter.status, 0, addFilter.stderr)
  assertDeferred('git status')
  assertDeferred('git diff --check')
  writeFileSync(join(project.cwd, '.git', 'config'), '[broken\n')
  assertDeferred('git status')
})

test('exact npm tasks require manual execution without launching a script or model', (t) => {
  const project = fixture(t)
  project.setupTool()
  project.fakeCLI('npm')
  const binary = project.fakeCLI('native Codex')
  const config = project.config({ named: { provider: 'codex', binary, access: 'edit' } })
  for (const args of [['test'], ['run', 'build'], ['run', 'typecheck']]) {
    const task = project.writeTask(['npm', ...args].join(' '))
    const preview = project.invoke('auto-plan', 'named', task, config)
    assert.equal(preview.status, 0, preview.stderr)
    const plan = JSON.parse(preview.stdout)
    assert.equal(plan.tier, 'L0')
    assert.equal(plan.target, 'local')
    assert.equal(plan.requiresManualRun, true)
    assert.deepEqual(plan.argv, ['npm', ...args])

    const outcome = project.invoke('auto-run', 'named', task, config)
    assert.equal(outcome.status, 2, outcome.stderr)
    assert.equal(outcome.stdout, '')
    assert.match(outcome.stderr, /run.*directly.*trusted project.*no model/i)
  }
})

test('auto planning routes only complete single requests locally and preserves the manual plan', (t) => {
  const project = fixture(t)
  project.setupTool()
  const cases = [
    'git status && touch unexpected',
    'git diff --check; echo extra',
    'npm test -- --watch',
    'npm run build && npm test',
    'git status # comment',
    'git status\n再解释所有变更',
    '```sh\ngit status\n```',
    '# 当前项目\n\n## 目标\ngit status',
    'Compare the status of both git worktrees.',
  ]
  for (const body of cases) {
    const task = project.writeTask(body)
    const result = project.invoke('auto-plan', 'claude', task)
    assert.equal(result.status, 0, result.stderr)
    const plan = JSON.parse(result.stdout)
    assert.equal(plan.tier, 'L2', body)
    assert.equal(plan.target, 'provider', body)
    assert.deepEqual(plan.argv, ['claude', ...expectedArgs.claude])
  }
  const exactTask = project.writeTask('git status')
  const manual = project.invoke('plan', 'codex', exactTask)
  assert.equal(manual.status, 0, manual.stderr)
  const plan = JSON.parse(manual.stdout)
  assert.equal(Object.hasOwn(plan, 'tier'), false)
  assert.deepEqual(plan.argv, ['codex', ...expectedArgs.codex])
})

test('auto planning uses scoped edits, general and complexity tiers', (t) => {
  const project = fixture(t)
  project.setupTool()
  const cases = [
    ['修正 README 的一处错别字', 'L1', 'gpt-6.2-sol', 'low'],
    ['Fix a typo in the README.', 'L1', 'gpt-6.2-sol', 'low'],
    ['仅调整按钮字号', 'L1', 'gpt-6.2-sol', 'low'],
    ['Change the submit button font size to 14px.', 'L1', 'gpt-6.2-sol', 'low'],
    ['调整按钮字号并重构前端页面', 'L2', 'gpt-6.2-sol', 'medium'],
    ['调整架构师简介的一处错别字', 'L1', 'gpt-6.2-sol', 'low'],
    [
      ['## 目标', '修正 README 的一处错别字', '## 权限边界', '请不要调整架构和数据库权限。'].join('\n'),
      'L1', 'gpt-6.2-sol', 'low',
    ],
    [
      ['## Goal', 'Fix a typo in the README.', '## Architecture constraints', '**Do not** migrate the database.'].join('\n'),
      'L1', 'gpt-6.2-sol', 'low',
    ],
    [
      ['## 目标', '修正 README 的一处错别字', '## 权限与限制', '不要调整数据库权限。', '## 验收', '只核对文字。'].join('\n'),
      'L1', 'gpt-6.2-sol', 'low',
    ],
    ['实现设置页搜索功能', 'L2', 'gpt-6.2-sol', 'medium'],
    ['修改一处错别字并更新设置页功能', 'L2', 'gpt-6.2-sol', 'medium'],
    ['修正一处错别字，随后实现设置页搜索', 'L2', 'gpt-6.2-sol', 'medium'],
    ['修正一处错别字。然后跑整套测试。', 'L2', 'gpt-6.2-sol', 'medium'],
    ['Review the authish and authorizationish labels.', 'L2', 'gpt-6.2-sol', 'medium'],
    [
      ['## 权限与限制', '保持当前设置。', '## 目标', '实现搜索。', '```md', '设计架构和数据库迁移', '```'].join('\n'),
      'L2', 'gpt-6.2-sol', 'medium',
    ],
    ['Review the wording around `database migration`.', 'L2', 'gpt-6.2-sol', 'medium'],
    ['审查跨模块架构并调整权限边界', 'L3', 'gpt-6.2-astra', 'high'],
    ['排查数据库连接间歇性超时', 'L3', 'gpt-6.2-astra', 'high'],
    ['修复鉴权绕过并添加回归验证', 'L3', 'gpt-6.2-astra', 'high'],
    ['Plan a production database migration.', 'L3', 'gpt-6.2-astra', 'high'],
    ['Diagnose an intermittent deadlock.', 'L3', 'gpt-6.2-astra', 'high'],
  ]
  for (const [body, tier, model, effort] of cases) {
    const task = project.writeTask(body)
    const result = project.invoke('auto-plan', 'codex', task)
    assert.equal(result.status, 0, result.stderr)
    const plan = JSON.parse(result.stdout)
    assert.equal(plan.tier, tier, body)
    assert.equal(plan.target, 'provider')
    assert.ok(plan.reason)
    assert.deepEqual(plan.requested, { provider: 'codex' })
    assert.deepEqual(plan.argv, [
      'codex', ...expectedArgs.codex.slice(0, -1),
      '--model', model, '--config', `model_reasoning_effort="${effort}"`, '-',
    ])
  }
})

test('Chinese task wording preserves scope and signals difficult work', async (t) => {
  const project = fixture(t)
  project.setupTool()
  const cases = [
    ['修改 README 的标题顺便加个搜索', 'L2'],
    ['# 按钮样式\n## 目标\n仅调整按钮字号。\n## 限制\n只改当前组件。', 'L1'],
    ['调整数据库连接池参数', 'L3'],
    ['排查偶发的服务超时', 'L3'],
  ]
  for (const [body, tier] of cases) {
    await t.test(body.split('\n')[0], () => {
      const task = project.writeTask(body)
      const result = project.invoke('auto-plan', 'codex', task)
      assert.equal(result.status, 0, result.stderr)
      assert.equal(JSON.parse(result.stdout).tier, tier)
    })
  }
})

test('automatic model choices respect the named profile, overrides and access', (t) => {
  const project = fixture(t)
  project.setupTool()
  const task = project.writeTask('Execute our database migration plan.')
  const profiles = {
    pinned: {
      provider: 'codex', access: 'edit', model: 'gpt-local', effort: 'low',
      tiers: { L3: { model: 'gpt-other', effort: 'max' } },
    },
    byTier: { provider: 'codex', tiers: { L3: { model: 'codex-local' } } },
    alternate: { provider: 'claude', tiers: { L3: { model: 'opus', effort: 'high' } } },
    harness: { provider: 'dsh', access: 'edit' },
  }
  const config = project.config(profiles)
  const cases = [
    ['pinned', ['codex', '--ask-for-approval', 'never', 'exec', '--sandbox', 'workspace-write', '--json',
      '--model', 'gpt-local', '--config', 'model_reasoning_effort="low"', '-']],
    ['byTier', ['codex', ...expectedArgs.codex.slice(0, -1), '--model', 'codex-local', '-']],
    ['alternate', ['claude', ...expectedArgs.claude, '--model', 'opus', '--effort', 'high']],
    ['harness', ['dsh', ...expectedArgs.dsh.map((arg) => arg === 'read-only' ? 'workspace-write' : arg)]],
  ]
  for (const [profile, argv] of cases) {
    const result = project.invoke('auto-plan', profile, task, config)
    assert.equal(result.status, 0, result.stderr)
    const plan = JSON.parse(result.stdout)
    assert.equal(plan.tier, 'L3')
    assert.deepEqual(plan.requested, profiles[profile])
    assert.deepEqual(plan.argv, argv)
  }
  const manual = project.invoke('plan', 'alternate', task, config)
  assert.equal(manual.status, 0, manual.stderr)
  assert.deepEqual(JSON.parse(manual.stdout).argv, ['claude', ...expectedArgs.claude])
})

test('invalid tier overrides fail closed', (t) => {
  const project = fixture(t)
  project.setupTool()
  const task = project.writeTask('修正 README 的一处错别字')
  const profiles = [
    { provider: 'codex', tiers: [] },
    { provider: 'codex', tiers: { L0: { model: 'example' } } },
    { provider: 'codex', tiers: { L1: { provider: 'claude' } } },
    { provider: 'codex', tiers: { L1: { access: 'edit' } } },
    { provider: 'codex', tiers: { L1: { model: '--config' } } },
    { provider: 'claude', tiers: { L1: { effort: 'fast' } } },
    { provider: 'dsh', tiers: { L1: { effort: 'low' } } },
  ]
  for (const profile of profiles) {
    const result = project.invoke('auto-plan', 'custom', task, project.config({ custom: profile }))
    assert.equal(result.status, 1)
    assert.match(result.stderr, /tiers/)
    assert.equal(result.stdout, '')
  }
})

test('auto-run keeps composite tasks intact and preserves native streams and status', {
  skip: process.platform === 'win32' && 'uses a POSIX executable script as a stand-in',
}, (t) => {
  const project = fixture(t)
  project.setupTool()
  const body = Buffer.from('git status\r\n然后修正一处错别字，字面保留 $(touch unexpected)\r\n')
  const task = project.writeTask(body)
  const binary = project.fakeCLI('native Claude')
  const config = project.config({ named: { provider: 'claude', binary } })
  const outcome = project.invoke('auto-run', 'named', task, config)
  assert.equal(outcome.status, 7, outcome.stderr)
  assert.equal(outcome.stderr, 'provider diagnostic\n')
  assert.deepEqual(JSON.parse(outcome.stdout), {
    args: expectedArgs.claude,
    cwd: project.cwd,
    input: body.toString('base64'),
  })
})
