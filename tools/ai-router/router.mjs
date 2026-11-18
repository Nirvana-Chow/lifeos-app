import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { constants } from 'node:os'
import { isAbsolute } from 'node:path'

const defaultProfiles = new URL('profiles.example.json', import.meta.url)
const allowedFields = ['provider', 'access', 'binary', 'model', 'effort', 'tiers']
const effortLevels = {
  codex: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  dsh: [],
}

const codexTiers = {
  L1: { model: 'gpt-6.2-sol', effort: 'low' },
  L2: { model: 'gpt-6.2-sol', effort: 'medium' },
  L3: { model: 'gpt-6.2-astra', effort: 'high' },
}

const gitReadOnly = ['git', '--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false']
const gitStatus = { argv: [...gitReadOnly, 'status'], reason: 'Single Git status request' }
const localTasks = new Map([
  ['git status', gitStatus],
  ['查看 git 状态', gitStatus],
  ['git diff --check', {
    argv: [...gitReadOnly, 'diff', '--no-ext-diff', '--no-textconv', '--check'],
    reason: 'Single Git whitespace check',
  }],
  ['npm test', npmTask(['test'])],
  ['npm run build', npmTask(['run', 'build'])],
  ['npm run typecheck', npmTask(['run', 'typecheck'])],
])
const goalHeading = /^(?:目标|goal)$/iu
const taskHeading = /^(?:任务|范围|task|scope)$/iu
const supportingHeading = /^(?:限制|约束|禁止事项|权限(?:与限制|边界)?|架构约束|验收(?:与回执|标准)?|已知(?:信息|事实)|背景|现状|(?:architecture )?constraints|permission(?: boundary|s)?|acceptance criteria|context|background)$/iu
const forbiddenAction = /^(?:请\s*)?(?:不得|禁止|不要|无需|跳过|不(?:改|动|调|做|迁|涉及|访问|运行)|do not\b|don't\b|never\b|avoid\b|no\b)/iu
const complexitySignals = [
  /架构(?!师)|跨(?:模块|服务|系统|仓库)|竞态|死锁|数据丢失|鉴权绕过|安全漏洞/u,
  /(?:数据库|数据)(?:迁移|回滚|一致性)|(?:权限|授权|访问)(?:边界|控制)|(?:修复|修改|设计|审计|排查|诊断|重构|变更|迁移).{0,16}(?:数据库|生产数据|安全策略|权限|鉴权|身份认证)/u,
  /(?:排查|诊断|定位|修复).{0,25}(?:并发|间歇|偶发|生产故障|线上故障)/u,
  /(?:调整|配置).{0,10}数据库连接池/u,
  /\b(?:architecture|cross[- ](?:module|service|repository|system)|race condition|deadlock|data loss|security vulnerability|privilege escalation|authorization bypass)\b/iu,
  /\b(?:(?:database|schema|production data) (?:migration|rollback)|(?:permission|authorization|access) (?:boundary|control)|(?:fix|refactor|audit|diagnose|investigate|change) (?:the |an? )?(?:auth(?:entication|orization)?|database|permissions?|intermittent|concurrency))\b/iu,
]
const simpleCopyedit = [
  /^(?:请\s*)?(?:修正|更正|修复|修改|更新|调整|润色|改正).{0,65}(?:错别字|错字|标点|拼写|文案|措辞|标题|一句话).{0,18}$/u,
  /^(?:please\s+)?(?:fix|correct|edit|polish|update|rewrite)\b.{0,65}\b(?:typo|spelling|punctuation|wording|copy|title|one sentence)\b.{0,36}$/iu,
]
const simpleStyleChange = [
  /^(?:请\s*)?(?:仅|只)?(?:调整|修改|设置|更改|增大|减小).{0,24}(?:按钮|标题|链接|标签|图标|徽章|输入框)(?:的)?(?:字号|字重|颜色|间距|圆角|边距).{0,18}$/u,
  /^(?:please\s+)?(?:change|adjust|set|update)\b.{0,30}\b(?:button|heading|link|label|icon|badge|input)\b.{0,15}\b(?:font size|font weight|colou?r|spacing|border radius|margin|padding)\b.{0,30}$/iu,
]
const additionalAction = /[。！？!?；;，,、]|\.\s|\b(?:and|then|also)\b|(?:随后|然后|另外|顺便|顺带|同时|以及|并(?:且|再|实现|执行|改|更新|测试|添加|调整|修复|验证|重构|部署)|再(?:改|查|跑|写))/iu

function npmTask(args) {
  return {
    argv: ['npm', ...args],
    requiresManualRun: true,
    reason: 'Single project script request requiring manual execution',
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateProfile(name, profile) {
  const label = `profile ${JSON.stringify(name)}`
  if (!isObject(profile)) throw new Error(`${label} must be a profile object`)
  for (const field of Object.keys(profile)) {
    if (!allowedFields.includes(field)) throw new Error(`${label} has an unknown field ${JSON.stringify(field)}`)
  }

  const { provider, access, binary, model, effort } = profile
  if (typeof provider !== 'string' || !Object.hasOwn(effortLevels, provider)) {
    throw new Error(`${label} has an unsupported provider`)
  }
  if (access !== undefined && !['inspect', 'edit'].includes(access)) {
    throw new Error(`${label} access must be "inspect" or "edit"`)
  }
  if (binary !== undefined && (
    typeof binary !== 'string' || binary.includes('\0')
    || (!isAbsolute(binary) && !/^[a-z0-9_][a-z0-9_.-]*$/i.test(binary))
  )) {
    throw new Error(`${label} binary must be an absolute path or an executable name on PATH`)
  }
  validateModelOptions(label, provider, { model, effort })
  if (profile.tiers !== undefined) validateTiers(label, provider, profile.tiers)
}

function validateModelOptions(label, provider, { model, effort }) {
  if (model !== undefined && (
    provider === 'dsh' || typeof model !== 'string' || !model || model.startsWith('-') || /[\s\p{Cc}]/u.test(model)
  )) {
    throw new Error(`${label} has an unsupported model option or invalid model name`)
  }
  if (effort !== undefined && !effortLevels[provider].includes(effort)) {
    throw new Error(`${label} has an unsupported effort option or value`)
  }
}

function validateTiers(label, provider, tiers) {
  if (provider === 'dsh' || !isObject(tiers)) {
    throw new Error(label + ' tiers requires a Codex or Claude tier map')
  }
  for (const [tier, options] of Object.entries(tiers)) {
    if (!Object.hasOwn(codexTiers, tier) || !isObject(options)) {
      throw new Error(label + ' tiers must map L1, L2 or L3 to model options')
    }
    if (Object.keys(options).some((key) => !['model', 'effort'].includes(key))) {
      throw new Error(label + ' tiers only supports model and effort')
    }
    validateModelOptions(label + ' tiers.' + tier, provider, options)
  }
}

async function readProfiles(configPath) {
  const config = await readFile(configPath, 'utf8')
  let profiles
  try {
    profiles = JSON.parse(config)
  } catch {
    throw new Error('profile configuration contains invalid JSON')
  }
  if (!isObject(profiles)) throw new Error('configuration must be a JSON profile map')
  for (const [name, profile] of Object.entries(profiles)) {
    validateProfile(name, profile)
  }
  return profiles
}

function taskProse(task) {
  const prose = []
  let fence
  let supporting = false
  let startsWithTitle = false
  let hasGoal = false
  for (const raw of task.replace(/<!--[\s\S]*?(?:-->|$)/gu, '').split(/\r?\n/u)) {
    const marker = /^ {0,3}(\x60{3,}|~{3,})(.*)$/u.exec(raw)
    if (fence) {
      if (marker?.[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
        fence = undefined
      }
      continue
    }
    if (marker) {
      fence = marker[1]
      continue
    }
    if (/^(?: {4}|\t| {0,3}>)/u.test(raw)) continue
    const line = raw.trim().replace(/^(?:[-*+] |\d+[.)] )/u, '')
    const heading = /^(#{1,6})\s+(.+?)\s*#*$/u.exec(line)
    const label = heading?.[2]
    if (label) {
      supporting = supportingHeading.test(label)
      if (goalHeading.test(label)) {
        hasGoal = true
        continue
      }
      if (supporting || taskHeading.test(label)) continue
    }
    const text = (label ?? line).replace(/(\x60+).*?\1/gu, ' ').replace(/[*_]{1,3}/gu, '').trim()
    if (text && !forbiddenAction.test(text)) {
      if (prose.length === 0 && heading?.[1] === '#' && !hasGoal) startsWithTitle = true
      prose.push({ text, supporting })
    }
  }
  if (startsWithTitle && hasGoal && prose.slice(1).some(({ supporting }) => !supporting)) {
    return prose.slice(1)
  }
  return prose
}

function routeTask(task) {
  const local = localTasks.get(task.toLowerCase())
  if (local) return { tier: 'L0', target: 'local', ...local }

  const prose = taskProse(task)
  if (prose.some(({ text }) => complexitySignals.some((signal) => signal.test(text)))) {
    return { tier: 'L3', target: 'provider', reason: 'Architecture, difficult diagnosis or high-risk work' }
  }

  const intent = prose.filter(({ supporting }) => !supporting)
  if (intent.length === 1) {
    const text = intent[0].text.replace(/[。.!?！？]$/u, '')
    if (!additionalAction.test(text)) {
      if (simpleCopyedit.some((signal) => signal.test(text))) {
        return { tier: 'L1', target: 'provider', reason: 'One scoped copy edit' }
      }
      if (simpleStyleChange.some((signal) => signal.test(text))) {
        return { tier: 'L1', target: 'provider', reason: 'One scoped style change' }
      }
    }
  }
  return { tier: 'L2', target: 'provider', reason: 'General task or unclear scope' }
}

function settingsForTier(profile, tier) {
  const defaults = profile.provider === 'codex' ? codexTiers[tier] : {}
  const override = profile.tiers?.[tier] ?? {}
  const model = profile.model ?? override.model ?? defaults.model
  const tierEffort = override.model === undefined || override.model === model ? override.effort : undefined
  const effort = profile.effort ?? tierEffort ?? (model === defaults.model ? defaults.effort : undefined)
  return { ...profile, model, effort }
}

function nativeCommand({ provider, access, binary = provider, model, effort }) {
  const sandbox = access === 'edit' ? 'workspace-write' : 'read-only'
  const modelArgs = model === undefined ? [] : ['--model', model]
  switch (provider) {
    case 'codex': {
      const effortArgs = effort === undefined ? [] : ['--config', `model_reasoning_effort="${effort}"`]
      return [
        binary, '--ask-for-approval', 'never', 'exec', '--sandbox', sandbox, '--json',
        ...modelArgs, ...effortArgs, '-',
      ]
    }
    case 'claude': {
      const mode = access === 'edit' ? 'acceptEdits' : 'plan'
      const effortArgs = effort === undefined ? [] : ['--effort', effort]
      return [
        binary, '-p', 'Follow the provided task', '--output-format', 'stream-json',
        '--verbose', '--permission-mode', mode, ...modelArgs, ...effortArgs,
      ]
    }
    case 'dsh':
      return [
        binary, '--profile', 'headless', '--permission-mode', sandbox,
        '--approval-policy', 'never', '--json', '-',
      ]
  }
}

function canRunGit() {
  const env = { ...process.env }
  // GIT_CONFIG changes "git config" only, so omit it when checking effective settings.
  delete env.GIT_CONFIG
  const result = spawnSync('git', [
    '--no-pager', 'config', '--includes', '--name-only', '--get-regexp', '^filter\\..*\\.(clean|process)$',
  ], { env, stdio: 'ignore', timeout: 5000, shell: false })
  return !result.error && result.status === 1
}

function deferLocalRun(argv, reason) {
  console.error('router: ' + reason + ' Run "' + argv.join(' ') + '" directly in a trusted project. No model was called.')
  return 2
}

function run([binary, ...args], task) {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { stdio: [task === undefined ? 'ignore' : 'pipe', 'inherit', 'inherit'], shell: false })
    let inputError
    child.stdin?.on('error', (error) => {
      inputError = error
    })
    child.on('error', (error) => {
      if (error.code === 'ENOENT') {
        console.error(`router: executable not found: ${JSON.stringify(binary)}`)
        resolve(127)
        return
      }
      console.error(`router: could not launch ${JSON.stringify(binary)} (${error.code ?? 'unknown error'})`)
      resolve(126)
    })
    child.on('close', (code, signal) => {
      if (code === 0 && inputError) {
        console.error(`router: could not send the task to stdin (${inputError.code ?? 'unknown error'})`)
        resolve(1)
        return
      }
      resolve(code ?? 128 + (constants.signals[signal] ?? 0))
    })
    child.stdin?.end(task)
  })
}

async function main([action, profile, taskPath, configPath = defaultProfiles, ...extra]) {
  if (!['plan', 'run', 'auto-plan', 'auto-run'].includes(action) || !profile || !taskPath || extra.length) {
    throw new Error('usage: node router.mjs <plan|run|auto-plan|auto-run> <profile> <task.md> [profiles.json]')
  }
  const profiles = await readProfiles(configPath)
  if (!Object.hasOwn(profiles, profile)) throw new Error(`unknown profile ${JSON.stringify(profile)}`)
  const requested = profiles[profile]
  const task = await readFile(taskPath)
  const taskText = task.toString('utf8').trim()
  if (!taskText) throw new Error('empty task')

  const route = action.startsWith('auto-') ? routeTask(taskText) : undefined
  const local = route?.target === 'local'
  const argv = route?.argv ?? nativeCommand(route ? settingsForTier(requested, route.tier) : requested)
  if (action === 'run' || action === 'auto-run') {
    if (route?.requiresManualRun) return deferLocalRun(argv, 'Project scripts require manual execution.')
    if (local && !canRunGit()) return deferLocalRun(argv, 'Git filter configuration is present or could not be checked.')
    return run(argv, local ? undefined : task)
  }

  console.log(JSON.stringify({
    status: 'planned',
    profile,
    requested,
    ...route,
    argv,
    cwd: process.cwd(),
    taskSha256: createHash('sha256').update(task).digest('hex'),
  }, null, 2))
  return 0
}

try {
  process.exitCode = await main(process.argv.slice(2))
} catch (error) {
  console.error(`router: ${error.message}`)
  process.exitCode = 1
}
