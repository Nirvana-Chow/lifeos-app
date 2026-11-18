import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { constants } from 'node:os'
import { isAbsolute } from 'node:path'

const defaultProfiles = new URL('profiles.example.json', import.meta.url)
const allowedFields = ['provider', 'access', 'binary', 'model', 'effort']
const effortLevels = {
  codex: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  dsh: [],
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
  if (model !== undefined && (
    provider === 'dsh' || typeof model !== 'string' || !model || model.startsWith('-') || /[\s\p{Cc}]/u.test(model)
  )) {
    throw new Error(`${label} has an unsupported model option or invalid model name`)
  }
  if (effort !== undefined && !effortLevels[provider].includes(effort)) {
    throw new Error(`${label} has an unsupported effort option or value`)
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

function run([binary, ...args], task) {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { stdio: ['pipe', 'inherit', 'inherit'], shell: false })
    let inputError
    child.stdin.on('error', (error) => {
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
    child.stdin.end(task)
  })
}

async function main([action, profile, taskPath, configPath = defaultProfiles, ...extra]) {
  if (!['plan', 'run'].includes(action) || !profile || !taskPath || extra.length) {
    throw new Error('usage: node router.mjs <plan|run> <profile> <task.md> [profiles.json]')
  }
  const profiles = await readProfiles(configPath)
  if (!Object.hasOwn(profiles, profile)) throw new Error(`unknown profile ${JSON.stringify(profile)}`)
  const requested = profiles[profile]
  const argv = nativeCommand(requested)
  const task = await readFile(taskPath)
  if (!task.toString('utf8').trim()) throw new Error('empty task')
  if (action === 'run') return run(argv, task)

  console.log(JSON.stringify({
    status: 'planned',
    profile,
    requested,
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
