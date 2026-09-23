# FixMemory

[English](README.md) | 简体中文

### 避免 Coding Agent 重复排查已经解决的问题。

[![npm version](https://img.shields.io/npm/v/fixmemory.svg)](https://www.npmjs.com/package/fixmemory)
[![CI](https://github.com/xixi-box/fixmemory/actions/workflows/ci.yml/badge.svg)](https://github.com/xixi-box/fixmemory/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/xixi-box/fixmemory.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-24%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

FixMemory 是一个本地优先的 MCP Server。它把调试过程中真正奏效的修复保存为有验证证据支持、可以复用的经验。Agent 开始排查前会先搜索当前项目的历史记录；只有 Agent 或用户确认检查通过后，记录才会进入正常搜索；项目经验经过跨项目复用后，才能提升为全局经验。

**不需要账号、API Key 或云数据库。**

需要 **Node.js 24+**。安装器支持 Windows、macOS 和 Linux；目前真实 Agent 的端到端验证在 Windows 上完成。

```bash
npx fixmemory@latest setup
```

安装后请重启正在运行的 Agent 会话。

## 解决一次，下次直接复用

```text
第一次遇到问题

Agent  → 搜索 FixMemory
       → 没有找到匹配记录
       → 定位根因
       → 修改代码并运行测试
       → 保存为已验证的项目记忆

再次遇到类似问题

Agent  → 搜索 FixMemory
       → 找到之前验证过的修复
       → 检查环境差异
       → 应用修复并重新验证
```

仓库中的[端到端测试](tests/mcp-e2e.test.ts)使用官方 MCP Client 完整复现了 propose → confirm → search 流程。

## 它和普通 Agent Memory 有什么不同？

| 普通 Memory | FixMemory |
| --- | --- |
| 保存对话、偏好或笔记 | 保存症状、根因、解决办法和验证证据 |
| 新内容写入后立即可用 | 新记录先作为 candidate，验证通过后才参与正常搜索 |
| 不同项目的上下文容易混在一起 | 先查当前项目，再查本机全局记忆 |
| 旧建议容易被误认为仍然适用 | 返回结果时明确列出环境差异 |
| 知识往往默认全局共享 | 在两个项目中成功复用后才能提升 |
| 错误记录难以治理 | 支持反馈、淘汰、替代关系和受保护删除 |

FixMemory 不是个人知识库。它只记调试经验，不保存普通对话。

### FixMemory 和 GitNexus 是互补关系

[GitNexus](https://github.com/digitalapplied/gitnexus)分析当前代码库的依赖、调用路径和变更影响。FixMemory 保存过去的调试经历，包括当时的症状、根因、有效修改和验证证据。

用 GitNexus 理解眼前的代码，用 FixMemory 避免重复调查已经解决过的问题。

## 验证流程

```mermaid
flowchart LR
    A[搜索历史修复] --> B[正常排查]
    B --> C[提出候选记录]
    C --> D[Agent 或用户运行检查]
    D -->|失败| B
    D -->|通过| E[已验证的项目记忆]
    E --> F[在其他项目中确实有用]
    F --> G[全局候选记录]
    G --> H[再次验证]
```

Candidate 不会出现在正常搜索中。某条已验证记录如果过时，可以将它标记为 superseded，并保留淘汰原因和可选的替代记录；之后正常搜索不会再返回它。

### “已验证”具体指什么？

FixMemory 不会自行证明根因。Agent 或用户需要运行相关测试、构建、复现步骤或运维检查，并提交检查成功的说明。FixMemory 负责强制执行 candidate → verified 的状态转换并保存证据。

检查通过只表示这条记录可以参与搜索，不代表解决方案在所有环境下都正确。搜索结果仍然只是排查线索；FixMemory 会显示环境差异，也允许记录 irrelevant 或 harmful 反馈。

## MCP + Skill

FixMemory 会安装两层能力：

- **MCP Server：**提供跨 Harness 使用的工具，并管理本地 SQLite 数据库。
- **共享 Skill：**告诉兼容的 Agent 应该在什么时候搜索、验证、反馈或淘汰记忆。

MCP 负责让不同 Harness 都能访问数据，Skill 负责把这些工具组织成一套可靠的调试流程。某个 MCP Client 即使不能发现共享 Skill，也可以通过自己的提示词调用全部工具。

## Harness 支持成熟度

| Harness | 安装方式 | 当前验证情况 |
| --- | --- | --- |
| Local Coding Agent | 一条命令 | Windows 上通过真实模型 + MCP 端到端验证 |
| Codex | 一条命令 | 配置适配器 + MCP 协议测试 |
| zCode | 一条命令 | 配置适配器测试 |
| 其他 MCP Client | 需要适配器 | 使用标准 stdio MCP Server |

无人值守安装：

```bash
npx fixmemory@latest setup --agents codex,zcode,local-agent
```

如果不传 `--agents`，安装器会检测受支持的 Harness 目录，让用户选择需要启用的目标，然后安装共享 Runtime 和 Skill。它只会向所选配置文件中添加由 FixMemory 管理的配置项，修改前会先备份原文件。

Claude Code、Cursor、OpenCode、VS Code 等 Harness 的一键适配还在路线图中。欢迎贡献小型配置适配器，具体要求见 [Adding a Harness adapter](CONTRIBUTING.md#adding-a-harness-adapter)。

## MCP 工具

| 工具 | 用途 |
| --- | --- |
| `fixmemory_search` | 先查当前项目，再查本机全局的已验证修复 |
| `fixmemory_get` | 按 ID 查看一条记录及其审计信息 |
| `fixmemory_list` | 按状态筛选并分页查看记忆 |
| `fixmemory_propose` | 创建尚未验证的 candidate |
| `fixmemory_confirm` | 检查成功后，让 candidate 进入正常搜索 |
| `fixmemory_feedback` | 记录一次复用是 helpful、irrelevant 还是 harmful |
| `fixmemory_promote` | 在跨项目复用后创建全局 candidate |
| `fixmemory_supersede` | 淘汰过时记录，并可关联替代记录 |
| `fixmemory_delete` | 永久删除 candidate 或已经淘汰的记录 |

执行破坏性操作的工具带有明确的 MCP 注解。已验证记录不能直接删除，必须先将其淘汰，避免一次误调用抹掉仍然有效的经验。

### 可选：Jev 相关性重排

默认关闭。给 MCP Server 进程设置 `FIXMEMORY_JEV_RERANK=1` 和 `TYPESAFE_API_KEY` 后，`fixmemory_search` 会把当前查询和全部候选修复打包成一次请求，发送到 [jevai.org](https://www.jevai.org) 的 Jev 决策模型做相关性判断，并按概率重排结果（每条匹配附带 `jev_relevance` 和 `jev_rank_before`）。失败或限流时自动回到确定性排序，搜索永不因此失败。分数只影响排序：不过滤结果，也不参与 candidate → verified 的验证门槛。

## 本地数据与隐私

本机数据库默认保存在：

```text
~/.fixmemory/data/memory.db
```

默认情况下 FixMemory 不会上传调试记忆；唯一例外是上面显式开启的 Jev 重排，它只发送单次搜索的查询与候选文本。数据库使用 SQLite WAL 模式，多个本地 MCP 进程可以安全共享；写入前会检查疑似凭据或私钥；如果项目存在 Git remote，则使用它的哈希作为项目身份。

这里的“全局”只表示同一用户、同一台机器上的多个项目可以访问，并不表示数据会上传或在线共享。在 Windows 上，`~` 指当前用户的主目录，例如 `C:\Users\name`。

敏感信息检查只是最后一道防线，不能保证拦住所有问题。Agent 提交的记忆可能包含路径、命令、调用栈或代码片段。请勿主动写入凭据、Token、私钥、专有源代码或未经脱敏的生产数据。

## 命令

```bash
# 安装、升级或修复选中的集成
npx fixmemory@latest setup

# 检查 Runtime 和 MCP 工具发现是否正常
npx fixmemory@latest doctor

# 移除集成和 Runtime，但保留记忆数据
npx fixmemory@latest uninstall

# 同时删除本地记忆数据库
npx fixmemory@latest uninstall --delete-data
```

Setup 修改 Harness 配置文件前会先创建备份。重复运行 setup 是安全的，卸载时也只移除 FixMemory 自己管理的配置。

## 开发

需要 Node.js 24 或更高版本。

```bash
npm install
npm run check
```

`npm run check` 会执行严格类型检查、构建打包后的运行时、运行存储层、MCP 和安装器测试，并检查 npm tarball。CI 会在 Windows、macOS 和 Linux 上运行同一套检查。

贡献要求见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 路线图

- 为 Claude Code、Cursor、OpenCode 和 VS Code 提供一键安装适配器
- 支持导出和导入，方便备份及迁移
- 在更换检索引擎前建立一套可复现的调试搜索评测集
- 增加更多真实 Harness 兼容性测试

FixMemory 目前使用确定性的本地检索。只有评测数据证明语义搜索能提高真实调试场景下的召回效果时，才会考虑引入它。

## 许可证

[MIT](LICENSE)
