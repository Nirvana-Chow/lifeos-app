# 同一份任务交给不同的编程助手

从项目目录运行这个小工具。它读取一份 Markdown 任务，按选定的配置把原文交给 Codex、Claude Code 或 DeepSeek Harness（DSH）。代码、分支、验收命令和交接记录都可以留在项目里。换工具时继续使用同一份文件。

## 第一次使用

需要 Node.js（本仓库使用 Node 24）以及本次选用的客户端。将整个 `ai-router` 目录复制到目标项目，然后在目标项目根目录执行。下面的 `plan` 只打印将使用的命令、项目目录和任务原文的 SHA-256，在安装客户端前也可以运行。实际调用 Codex 时，默认在 Git 仓库内运行。

```sh
node ai-router/router.mjs plan codex ai-router/task.example.md
node ai-router/router.mjs plan claude ai-router/task.example.md
node ai-router/router.mjs plan dsh ai-router/task.example.md
```

选好客户端，确认预览中的项目目录、任务和权限。以下命令会实际调用 Codex，沿用该客户端在这台机器上的登录及用量设置。

```sh
node ai-router/router.mjs run codex ai-router/task.example.md
```

如果终端已经位于工具目录，预览示例可直接执行 `node router.mjs plan codex task.example.md`。

在 LifeOS 源码仓库中，上述命令里的工具目录是 `tools/ai-router/`。在图形客户端中，也可以直接打开相同的项目、选好分支，把任务文件正文发给它。

## 自动按任务难度选档

从项目目录预览路由，再执行相同的任务。

```sh
node ai-router/router.mjs auto-plan codex ai-router/task.example.md
node ai-router/router.mjs auto-run codex ai-router/task.example.md
```

| 档位 | 识别范围 | Codex 默认请求 |
| --- | --- | --- |
| L0 | 整份文件是下方支持的一条固定命令或 Git 状态请求 | 本地执行 Git 检查。项目脚本需手动启动 |
| L1 | 一项明确的文字修改或局部样式调整，例如按钮字号 | `gpt-6.2-sol` · low |
| L2 | 常规开发或难度不明确 | `gpt-6.2-sol` · medium |
| L3 | 架构、跨模块、困难故障、权限和数据库等高风险工作 | `gpt-6.2-astra` · high |

L0 支持 `git status`、`查看 Git 状态`、`git diff --check`、`npm test`、`npm run build` 和 `npm run typecheck`。Git 检查使用原生命令和退出码。如果 Git 配置含可执行的 clean 或 process 过滤器，或无法核实配置，工具会提示在受信项目内直接运行该命令。npm 命令会运行项目自定义脚本，预览标记 `requiresManualRun: true`。请在受信项目里手动运行预览中的命令。npm 请求的 `auto-run` 会返回退出码 2，保留当前权限并结束，整个过程无需模型。

`auto-plan` 只在本地分析，输出档位 `tier`、判定理由 `reason`、执行目标 `target` 和预计使用的 `argv`。分档参考任务文字。围栏代码和常见模板标题不参与判定。给状态查询再加一条任务会把完整文件交给所选客户端。也可以用原来的 `plan` 和 `run` 明确使用手动配置。

自动分档继承所选配置的客户端和读写权限。Claude Code 沿用现有配置，也可通过 `tiers` 为指定档位配置模型和推理强度。DeepSeek Harness 沿用客户端内的选型。配置最外层的 `model` 和 `effort` 优先于档位配置。若所选模型和档位默认不同，且未提供可用于该模型的强度设置，则由客户端决定。

```json
{
  "my-codex": {
    "provider": "codex",
    "access": "edit",
    "tiers": {
      "L3": {"model": "gpt-6.2-astra", "effort": "high"}
    }
  },
  "my-claude": {
    "provider": "claude",
    "tiers": {
      "L1": {"model": "haiku", "effort": "low"}
    }
  }
}
```

## 配置模型、命令位置和读写权限

把以下示例存成自己机器上的 `profiles.local.json`，然后在命令最后传入该文件路径。每个名字对应一组配置。下例中的模型和命令路径根据本机实际安装与账户能力调整。

```json
{
  "codex-review": {"provider": "codex", "model": "gpt-6.2-sol", "effort": "medium"},
  "codex-edit": {"provider": "codex", "access": "edit"},
  "claude-edit": {"provider": "claude", "access": "edit"},
  "dsh-desktop": {"provider": "dsh", "binary": "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"}
}
```

```sh
node ai-router/router.mjs plan dsh-desktop ai-router/task.example.md profiles.local.json
```

默认 `inspect` 为 Codex 和 DSH 选择只读工作区，在 Claude Code 中选择规划模式。显式 `edit` 在 Codex 和 DSH 中申请工作区写入，在 Claude Code 中使用 `acceptEdits`，允许常规文件编辑。审批、登录、会话保存和工具能力取决于客户端。无交互运行遇到必须人工确认的操作时，先查看原生输出，再决定如何继续。Codex 可以请求 low、medium、high、xhigh、max 或 ultra，Claude Code 可以请求 low、medium、high、xhigh 或 max，实际支持的档位取决于模型。DSH 在自身设置里选模型，启动器拒绝它无法传递的模型或推理强度参数。

只使用受信的本机配置。配置文件可选定要运行的程序，任务正文将交给所选客户端。请只将允许交给所选服务的项目和任务用于实际运行。DSH headless 默认独立于图形端登录，DeepSeek 路由默认还可能上传含提示、工具内容与路径的会话日志。[DSH 登录说明](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/bundle/headless/README.md#credentials) · [会话日志说明](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/apps/cli/reference/README.md#L137-L141)

客户端的原始标准输出、错误输出和退出状态供调用者检查。验收时再查看 Git 差异和测试结果。换客户端交接时，把已完成的改动、当前分支和下一条验收命令写进任务文件。

运行工具自测只需要 Node.js。

```sh
node --test ai-router/router.test.mjs
```
