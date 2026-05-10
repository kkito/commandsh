# commandsh - 安装 Slash Commands 工具设计

## 概述

在现有 `skills` CLI 基础上，新增 `commandsh` 工具，用于将 slash commands 安装到各 Agent 的 commands 目录。

## 核心需求

1. 支持从 GitHub 仓库或本地路径获取 commands
2. commands 源结构：`commands/` 目录下扁平的 `*.md` 文件
3. 支持全局（`~/.agents/commands`）和项目级（`./.agents/commands`）两种安装范围
4. 自动检测已安装的 Agent，用户选择安装到哪些 Agent
5. 新建文件，尽量不改动现有代码
6. 独立 bin: `commandsh`
7. 包含测试

## 架构

### 新建文件

```
src/
├── commands-cli.ts           # CLI 入口、参数解析、主循环
├── commands-add.ts           # add 命令核心逻辑
├── commands-discovery.ts     # commands 发现（扫描扁平 *.md 文件）
├── commands-installer.ts     # 安装执行（复制文件到目标目录）
bin/
└── commands.mjs              # commands CLI 入口点
tests/
├── commands-add.test.ts      # 测试
├── commands-discovery.test.ts # 测试
└── commands-installer.test.ts # 测试
```

### 复用的现有代码（只 import，不修改）

- `source-parser.ts` - 解析 GitHub URL、本地路径等
- `git.ts` - Git clone 操作
- `agents.ts` - Agent 定义和检测
- `constants.ts` - `.agents` 常量
- `types.ts` - `AgentType` 等类型

## 安装流程

```
runCommandsAdd(source, options)
    │
    ├── 1. parseSource(source) ← 复用现有
    │
    ├── 2. 获取源
    │      ├── 本地路径 → 直接使用
    │      └── GitHub → cloneRepo() → 获取临时目录
    │
    ├── 3. discoverCommands(tempDir)
    │      └── 扫描 commands/ 目录下的 *.md 文件
    │          返回 [{ name: 'deploy', path: '/path/commands/deploy.md' }]
    │
    ├── 4. 命令选择
    │      ├── -y 或单个 → 自动选择
    │      └── 多个 → multiselect 交互
    │
    ├── 5. Agent 选择（复用 getInstalledAgents）
    │      └── 检测支持 commands 的 Agent + 用户选择
    │
    ├── 6. 范围选择
    │      ├── --global → ~/.agents/commands
    │      └── 默认 → ./.agents/commands
    │
    ├── 7. 执行安装
    │      └── 对每个 (command, agent):
    │          - 复制到规范目录 ~/.agents/commands/<cmd>.md
    │          - 为每个 Agent 复制/链接到其 commands/ 目录
    │
    └── 8. 清理临时目录
```

## Agent Commands 目录映射

```typescript
const COMMANDS_AGENT_DIRS: Record<AgentType, string> = {
  'claude-code': '~/.claude/commands',
  'cursor': '~/.cursor/commands',
  'cline': '~/.cline/commands',
  // ... 其他支持 commands 的 Agent
};
```

全局安装：
- 先复制到 `~/.agents/commands/<cmd>.md`
- 再为每个 Agent 创建 symlink 或复制到 `~/.<agent>/commands/<cmd>.md`

项目级安装：
- 复制到 `./.agents/commands/<cmd>.md`
- 再为每个 Agent 创建 symlink 或复制到 `./.agent/commands/<cmd>.md`

## 错误处理

- **源不存在**：Git clone 失败或本地路径不存在 → 报错退出
- **没有发现 commands**：`commands/` 目录不存在或没有 `.md` 文件 → 提示用户
- **目标目录权限问题**：写入失败 → 报错并建议检查权限
- **命令名称冲突**：目标目录已有同名 `.md` 文件 → 提示是否覆盖

## package.json 变更

```json
{
  "bin": {
    "skills": "./bin/cli.mjs",
    "add-skill": "./bin/cli.mjs",
    "commandsh": "./bin/commands.mjs",
    "add-command": "./bin/commands.mjs"
  },
  "keywords": [
    "...现有 keywords...",
    "slash-commands",
    "commands",
    "claude-commands",
    "cursor-commands"
  ]
}
```

## 测试策略

- `commands-discovery.test.ts`：测试 commands 发现逻辑（扫描 `commands/*.md`）
- `commands-installer.test.ts`：测试安装逻辑（复制文件、symlink 创建）
- `commands-add.test.ts`：测试完整的 add 命令流程

## 不做的事情

- 不实现 lock 文件机制（commands 通常不需要更新检查）
- 不实现 `check`/`update` 命令
- 不修改任何现有的 `*.ts` 文件（只新建文件）
