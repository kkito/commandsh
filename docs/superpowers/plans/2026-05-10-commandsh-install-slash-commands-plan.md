# commandsh - 安装 Slash Commands 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 `commandsh` CLI 工具，用于从 GitHub 仓库或本地路径安装 slash commands 到各 Agent 的 commands 目录

**Architecture:** 参考现有 skills 架构，新建 4 个源文件 + 1 个 bin 入口 + 3 个测试文件，不修改任何现有代码。commands 发现逻辑扫描 `commands/` 目录下的扁平 `*.md` 文件，安装时复制到规范目录和 Agent 特定目录。

**Tech Stack:** TypeScript, Node.js fs/promises, @clack/prompts, picocolors, Vitest

---

## 文件结构

```
bin/
└── commands.mjs                          # 新建 - CLI 入口点
src/
├── commands-cli.ts                       # 新建 - 命令路由和主循环
├── commands-add.ts                       # 新建 - add 命令核心逻辑 + 选项解析
├── commands-discovery.ts                 # 新建 - commands 发现（扫描 commands/*.md）
├── commands-installer.ts                 # 新建 - 安装执行（复制/symlink）
tests/
├── commands-discovery.test.ts            # 新建 - 发现逻辑测试
├── commands-installer.test.ts            # 新建 - 安装逻辑测试
├── commands-add.test.ts                  # 新建 - add 命令测试
package.json                              # 修改 - 新增 bin 和 keywords
```

---

## 共享类型定义（在 commands-add.ts 中内联定义）

```ts
interface CommandsAddOptions {
  global?: boolean;
  agent?: string[];
  yes?: boolean;
  command?: string[];
  list?: boolean;
  all?: boolean;
  copy?: boolean;
}

interface DiscoveredCommand {
  name: string;
  path: string;
}

type InstallMode = 'symlink' | 'copy';

interface CommandInstallResult {
  success: boolean;
  path: string;
  canonicalPath?: string;
  mode: InstallMode;
  symlinkFailed?: boolean;
  skipped?: boolean;
  error?: string;
}
```

---

### Task 1: commands-discovery.ts - Commands 发现逻辑

**Files:**
- Create: `src/commands-discovery.ts`
- Test: `tests/commands-discovery.test.ts`

**Responsibility:** 扫描源目录下的 `commands/` 子目录，发现所有 `*.md` 文件并返回命令列表。

- [ ] **Step 1: 编写测试文件**

```ts
// tests/commands-discovery.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverCommands } from '../src/commands-discovery.ts';

describe('discoverCommands', () => {
  it('returns empty array when commands/ directory does not exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cmd-discovery-'));
    try {
      const commands = await discoverCommands(root);
      expect(commands).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('discovers *.md files in commands/ directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cmd-discovery-'));
    const commandsDir = join(root, 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'deploy.md'), '# Deploy command\n');
    await writeFile(join(commandsDir, 'review.md'), '# Review command\n');

    try {
      const commands = await discoverCommands(root);
      expect(commands).toHaveLength(2);
      expect(commands.map((c) => c.name)).toContain('deploy');
      expect(commands.map((c) => c.name)).toContain('review');
      expect(commands[0].path).toMatch(/commands\/deploy\.md$/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('ignores non-.md files in commands/ directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cmd-discovery-'));
    const commandsDir = join(root, 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'deploy.md'), '# Deploy\n');
    await writeFile(join(commandsDir, 'README.txt'), 'Readme\n');
    await writeFile(join(commandsDir, 'config.json'), '{}');

    try {
      const commands = await discoverCommands(root);
      expect(commands).toHaveLength(1);
      expect(commands[0].name).toBe('deploy');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses filename without extension as command name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cmd-discovery-'));
    const commandsDir = join(root, 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'my-cool-command.md'), '# Test\n');

    try {
      const commands = await discoverCommands(root);
      expect(commands).toHaveLength(1);
      expect(commands[0].name).toBe('my-cool-command');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm test tests/commands-discovery.test.ts
```
预期：所有测试失败（模块不存在）

- [ ] **Step 3: 编写 commands-discovery.ts 实现**

```ts
// src/commands-discovery.ts
import { readdir, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import type { DiscoveredCommand } from './commands-add.ts';

/**
 * Scan a source directory for commands in the commands/ subdirectory.
 * Returns a list of discovered command files (only *.md in the top-level commands/ dir).
 */
export async function discoverCommands(basePath: string): Promise<DiscoveredCommand[]> {
  const commandsDir = join(basePath, 'commands');

  let entries: string[];
  try {
    entries = await readdir(commandsDir);
  } catch {
    // commands/ directory doesn't exist
    return [];
  }

  const commands: DiscoveredCommand[] = [];

  for (const entry of entries) {
    // Only process .md files at the top level of commands/
    if (extname(entry) !== '.md') continue;

    const fullPath = join(commandsDir, entry);
    const entryStat = await stat(fullPath);
    if (!entryStat.isFile()) continue;

    commands.push({
      name: basename(entry, '.md'),
      path: fullPath,
    });
  }

  // Sort by name for consistent output
  commands.sort((a, b) => a.name.localeCompare(b.name));
  return commands;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm test tests/commands-discovery.test.ts
```
预期：所有测试通过

- [ ] **Step 5: 提交**

```bash
git add src/commands-discovery.ts tests/commands-discovery.test.ts
git commit -m "feat(commands): add command discovery logic

Scan commands/ directory for *.md files and return discovered commands.
Flat structure only - no nested subdirectories."
```

---

### Task 2: commands-installer.ts - Commands 安装逻辑

**Files:**
- Create: `src/commands-installer.ts`
- Test: `tests/commands-installer.test.ts`

**Responsibility:** 将命令文件复制到规范目录（`~/.agents/commands` 或 `./.agents/commands`）和各 Agent 的 commands 目录。提供 symlink 和 copy 两种模式。

- [ ] **Step 1: 编写测试文件**

```ts
// tests/commands-installer.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { homedir } from 'node:os';
import {
  sanitizeCommandName,
  getCanonicalCommandsDir,
  getAgentCommandsDir,
  installCommandForAgent,
} from '../src/commands-installer.ts';

describe('sanitizeCommandName', () => {
  it('converts to lowercase', () => {
    expect(sanitizeCommandName('Deploy')).toBe('deploy');
  });

  it('replaces non-alphanumeric with dash', () => {
    expect(sanitizeCommandName('my command')).toBe('my-command');
    expect(sanitizeCommandName('my_command')).toBe('my-command');
  });

  it('collapses multiple dashes', () => {
    expect(sanitizeCommandName('my--command')).toBe('my-command');
  });

  it('trims leading/trailing dash', () => {
    expect(sanitizeCommandName('-deploy-')).toBe('deploy');
  });
});

describe('getCanonicalCommandsDir', () => {
  it('returns global dir when global=true', () => {
    const result = getCanonicalCommandsDir(true, '/some/project');
    expect(result).toBe(join(homedir(), '.agents', 'commands'));
  });

  it('returns project dir when global=false', () => {
    const result = getCanonicalCommandsDir(false, '/some/project');
    expect(result).toBe(join('/some/project', '.agents', 'commands'));
  });
});

describe('installCommandForAgent', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'cmd-install-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('copies command file to agent commands dir in copy mode', async () => {
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const cmdDir = join(root, 'commands');
    await mkdir(cmdDir, { recursive: true });
    const cmdPath = join(cmdDir, 'deploy.md');
    await writeFile(cmdPath, '# Deploy command\nSome content');

    const result = await installCommandForAgent(
      { name: 'deploy', path: cmdPath },
      'claude-code',
      { cwd: projectDir, mode: 'copy', global: false }
    );

    expect(result.success).toBe(true);
    const agentCmdPath = join(projectDir, '.agents', 'commands', 'deploy.md');
    const content = await readFile(agentCmdPath, 'utf-8');
    expect(content).toBe('# Deploy command\nSome content');
  });

  it('creates canonical dir first then symlinks in symlink mode', async () => {
    const projectDir = join(root, 'project2');
    await mkdir(projectDir, { recursive: true });

    const cmdDir = join(root, 'commands2');
    await mkdir(cmdDir, { recursive: true });
    const cmdPath = join(cmdDir, 'review.md');
    await writeFile(cmdPath, '# Review\n');

    const result = await installCommandForAgent(
      { name: 'review', path: cmdPath },
      'claude-code',
      { cwd: projectDir, mode: 'symlink', global: false }
    );

    expect(result.success).toBe(true);
    const canonicalPath = join(projectDir, '.agents', 'commands', 'review.md');
    expect(result.canonicalPath).toBe(canonicalPath);

    // Verify the agent's commands dir has a symlink or copy
    const agentCmdPath = join(projectDir, '.claude', 'commands', 'review.md');
    const s = await lstat(agentCmdPath);
    expect(s.isSymbolicLink() || s.isFile()).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm test tests/commands-installer.test.ts
```
预期：所有测试失败

- [ ] **Step 3: 编写 commands-installer.ts 实现**

```ts
// src/commands-installer.ts
import { mkdir, copyFile, symlink, stat, access, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { AGENTS_DIR } from './constants.ts';
import type { AgentType } from './types.ts';
import type { DiscoveredCommand } from './commands-add.ts';

export type InstallMode = 'symlink' | 'copy';

export interface CommandInstallResult {
  success: boolean;
  path: string;
  canonicalPath?: string;
  mode: InstallMode;
  symlinkFailed?: boolean;
  skipped?: boolean;
  error?: string;
}

const COMMANDS_SUBDIR = 'commands';

/**
 * Map of agent types to their commands directory names.
 * Only agents that support commands should be listed here.
 */
const AGENT_COMMANDS_DIRS: Partial<Record<AgentType, string>> = {
  'claude-code': '.claude/commands',
  'cursor': '.cursor/commands',
  'cline': '.cline/commands',
};

/**
 * Sanitize a command name for safe file system use.
 */
export function sanitizeCommandName(name: string): string {
  let sanitized = name.toLowerCase();
  // Replace non-alphanumeric characters with dash
  sanitized = sanitized.replace(/[^a-z0-9]+/g, '-');
  // Collapse multiple dashes
  sanitized = sanitized.replace(/-+/g, '-');
  // Trim leading/trailing dash
  sanitized = sanitized.replace(/^-|-$/g, '');
  return sanitized || 'unnamed';
}

/**
 * Get the canonical commands directory.
 * Global: ~/.agents/commands
 * Project: <cwd>/.agents/commands
 */
export function getCanonicalCommandsDir(global: boolean, cwd: string = process.cwd()): string {
  if (global) {
    return join(homedir(), AGENTS_DIR, COMMANDS_SUBDIR);
  }
  return join(cwd, AGENTS_DIR, COMMANDS_SUBDIR);
}

/**
 * Get the agent-specific commands directory.
 */
export function getAgentCommandsDir(
  agentType: AgentType,
  global: boolean,
  cwd: string = process.cwd()
): string {
  const agentDir = AGENT_COMMANDS_DIRS[agentType];
  if (!agentDir) {
    // Fallback: use canonical dir for this agent
    return getCanonicalCommandsDir(global, cwd);
  }

  if (global) {
    return join(homedir(), agentDir);
  }
  return join(cwd, agentDir);
}

/**
 * Check if an agent supports commands.
 */
export function agentSupportsCommands(agentType: AgentType): boolean {
  return agentType in AGENT_COMMANDS_DIRS;
}

/**
 * Install a single command for a single agent.
 */
export async function installCommandForAgent(
  command: DiscoveredCommand,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string; mode?: InstallMode } = {}
): Promise<CommandInstallResult> {
  const { global = false, cwd: projectCwd = process.cwd(), mode = 'copy' } = options;
  const canonicalDir = getCanonicalCommandsDir(global, projectCwd);
  const agentDir = getAgentCommandsDir(agentType, global, projectCwd);
  const safeName = sanitizeCommandName(command.name);
  const canonicalPath = join(canonicalDir, `${safeName}.md`);
  const agentPath = join(agentDir, `${safeName}.md`);

  try {
    // Ensure canonical dir exists
    await mkdir(canonicalDir, { recursive: true });

    // Copy to canonical dir
    await copyFile(command.path, canonicalPath);

    // For agents, either symlink or copy
    if (mode === 'symlink') {
      await mkdir(dirname(agentPath), { recursive: true });
      try {
        // Try symlink first
        await symlink(canonicalPath, agentPath);
        return { success: true, path: agentPath, canonicalPath, mode: 'symlink' };
      } catch {
        // Fallback to copy if symlink fails (e.g., permissions)
        await copyFile(canonicalPath, agentPath);
        return {
          success: true,
          path: agentPath,
          canonicalPath,
          mode: 'copy',
          symlinkFailed: true,
        };
      }
    } else {
      // Copy mode
      await mkdir(dirname(agentPath), { recursive: true });
      await copyFile(canonicalPath, agentPath);
      return { success: true, path: agentPath, canonicalPath, mode: 'copy' };
    }
  } catch (error) {
    return {
      success: false,
      path: agentPath,
      mode,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check if a command is already installed for an agent.
 */
export async function isCommandInstalled(
  commandName: string,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string } = {}
): Promise<boolean> {
  const { global = false, cwd: projectCwd = process.cwd() } = options;
  const agentDir = getAgentCommandsDir(agentType, global, projectCwd);
  const safeName = sanitizeCommandName(commandName);
  const agentPath = join(agentDir, `${safeName}.md`);

  try {
    await stat(agentPath);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm test tests/commands-installer.test.ts
```
预期：所有测试通过

- [ ] **Step 5: 提交**

```bash
git add src/commands-installer.ts tests/commands-installer.test.ts
git commit -m "feat(commands): add command installation logic

Install commands to canonical dir and agent-specific dirs.
Support symlink and copy modes with fallback."
```

---

### Task 3: commands-add.ts - Commands Add 命令核心逻辑

**Files:**
- Create: `src/commands-add.ts`

**Responsibility:** 解析源（Git clone 或本地路径）、发现 commands、选择命令和 Agent、执行安装。是 `commandsh add` 的核心业务逻辑。

**注意：** 这个文件不包含 CLI 交互（那是 commands-cli.ts 的职责），只导出 `runCommandsAdd()` 和 `parseCommandsAddOptions()` 函数。

- [ ] **Step 1: 编写 commands-add.ts**

```ts
// src/commands-add.ts
import { existsSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { parseSource } from './source-parser.ts';
import { cloneRepo, cleanupTempDir } from './git.ts';
import { discoverCommands } from './commands-discovery.ts';
import {
  installCommandForAgent,
  isCommandInstalled,
  agentSupportsCommands,
  type InstallMode,
} from './commands-installer.ts';
import { detectInstalledAgents, agents, isUniversalAgent } from './agents.ts';
import type { AgentType, ParsedSource } from './types.ts';

export interface DiscoveredCommand {
  name: string;
  path: string;
}

export interface CommandsAddOptions {
  global?: boolean;
  agent?: string[];
  yes?: boolean;
  command?: string[];
  list?: boolean;
  all?: boolean;
  copy?: boolean;
}

interface SelectedCommand {
  name: string;
  path: string;
}

const isCancelled = (value: unknown): value is symbol => typeof value === 'symbol';

/**
 * Parse CLI arguments into CommandsAddOptions.
 */
export function parseCommandsAddOptions(args: string[]): { source: string; options: CommandsAddOptions } {
  const options: CommandsAddOptions = {};
  let source = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '-y' || arg === '--yes') {
      options.yes = true;
    } else if (arg === '--all' || arg === '-a') {
      options.all = true;
    } else if (arg === '--list' || arg === '-l') {
      options.list = true;
    } else if (arg === '--copy') {
      options.copy = true;
    } else if (arg === '--agent') {
      const next = args[++i];
      if (next) {
        options.agent = next === '*' ? ['*'] : next.split(',').map((s) => s.trim());
      }
    } else if (arg === '--command') {
      const next = args[++i];
      if (next) {
        options.command = next === '*' ? ['*'] : next.split(',').map((s) => s.trim());
      }
    } else if (!arg.startsWith('-') && !source) {
      source = arg;
    }
  }

  return { source, options };
}

/**
 * Main entry point for the `commandsh add` command.
 */
export async function runCommandsAdd(source: string, options: CommandsAddOptions): Promise<void> {
  if (!source) {
    p.log.error('Please provide a source (git repo URL, GitHub shorthand, or local path)');
    p.log.info(`Examples:
  ${pc.dim('$')} commandsh add my-commands-repo
  ${pc.dim('$')} commandsh add owner/commands-repo
  ${pc.dim('$')} commandsh add https://github.com/owner/commands-repo
  ${pc.dim('$')} commandsh add ./my-local-commands`);
    process.exit(1);
  }

  const parsed = parseSource(source);
  let tempDir: string | null = null;
  let basePath: string;

  try {
    // Step 1: Get source content
    if (parsed.type === 'local') {
      basePath = parsed.localPath!;
      if (!existsSync(basePath)) {
        p.log.error(`Path not found: ${pc.red(basePath)}`);
        process.exit(1);
      }
    } else {
      // Clone git repo
      const spinner = p.spinner();
      spinner.start('Cloning repository...');
      try {
        tempDir = await cloneRepo(parsed.url, parsed.ref);
        spinner.stop('Repository cloned');
      } catch (err) {
        spinner.stop('Failed to clone repository');
        p.log.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      // Determine subpath if provided
      basePath = parsed.subpath ? join(tempDir, parsed.subpath) : tempDir;
    }

    // Step 2: Discover commands
    const spinner = p.spinner();
    spinner.start('Discovering commands...');
    const commands = await discoverCommands(basePath);
    spinner.stop(`Found ${pc.cyan(commands.length.toString())} command(s)`);

    if (commands.length === 0) {
      p.log.error(
        `No commands found. Expected a ${pc.cyan('commands/')} directory with ${pc.cyan('*.md')} files.`
      );
      process.exit(1);
    }

    // Step 3: Command selection
    let selectedCommands: DiscoveredCommand[];
    if (options.command && options.command.includes('*')) {
      selectedCommands = commands;
    } else if (options.command && options.command.length > 0) {
      // Filter by provided command names
      selectedCommands = commands.filter((cmd) =>
        options.command!.some(
          (name) => cmd.name.toLowerCase() === name.toLowerCase()
        )
      );
      if (selectedCommands.length === 0) {
        p.log.error(
          `No matching commands found. Available: ${commands.map((c) => pc.cyan(c.name)).join(', ')}`
        );
        process.exit(1);
      }
    } else if (commands.length === 1) {
      selectedCommands = commands;
    } else if (options.yes || options.all) {
      selectedCommands = commands;
    } else {
      // Interactive selection
      const choices = commands.map((cmd) => ({
        value: cmd,
        label: cmd.name,
      }));

      const selected = await p.multiselect({
        message: 'Select commands to install:',
        options: choices,
        required: true,
      });

      if (isCancelled(selected)) {
        p.cancel('Installation cancelled');
        process.exit(0);
      }
      selectedCommands = selected as DiscoveredCommand[];
    }

    // Step 4: Agent selection
    let selectedAgents: AgentType[];
    if (options.agent && options.agent.includes('*')) {
      selectedAgents = Object.keys(agents).filter((a) =>
        agentSupportsCommands(a as AgentType)
      ) as AgentType[];
    } else if (options.agent && options.agent.length > 0) {
      selectedAgents = options.agent.filter((a) =>
        agentSupportsCommands(a as AgentType)
      ) as AgentType[];
    } else {
      // Detect installed agents and filter to those supporting commands
      const installedAgents = await detectInstalledAgents();
      const supportedAgents = installedAgents.filter((a) => agentSupportsCommands(a));

      // Always include universal agents that support commands
      const universalSupported = Object.keys(agents)
        .filter((a) => isUniversalAgent(a as AgentType) && agentSupportsCommands(a as AgentType))
        .map((a) => a as AgentType);

      const candidates = [...new Set([...supportedAgents, ...universalSupported])];

      if (candidates.length === 0) {
        p.log.error('No agents detected that support commands.');
        process.exit(1);
      }

      if (options.yes) {
        selectedAgents = candidates;
      } else {
        const agentChoices = candidates.map((a) => ({
          value: a,
          label: agents[a].displayName || agents[a].name,
        }));

        const selected = await p.multiselect({
          message: 'Select agents to install commands to:',
          options: agentChoices,
          required: true,
        });

        if (isCancelled(selected)) {
          p.cancel('Installation cancelled');
          process.exit(0);
        }
        selectedAgents = selected as AgentType[];
      }
    }

    // Step 5: Scope selection (global vs project)
    const isGlobal =
      options.global ??
      (await promptForScope());

    // Step 6: Install mode
    const installMode: InstallMode = options.copy ? 'copy' : 'symlink';

    // Step 7: Execute installation
    const results: Array<{ command: string; agent: string; result: Awaited<ReturnType<typeof installCommandForAgent>> }> = [];

    const installSpinner = p.spinner();
    installSpinner.start('Installing commands...');

    for (const cmd of selectedCommands) {
      for (const agent of selectedAgents) {
        // Check if already installed
        const installed = await isCommandInstalled(cmd.name, agent, {
          global: isGlobal,
        });
        if (installed && !options.yes) {
          const overwrite = await p.confirm({
            message: `${pc.cyan(cmd.name)} already installed for ${pc.cyan(agents[agent].name)}. Overwrite?`,
            initialValue: false,
          });
          if (isCancelled(overwrite) || !overwrite) {
            results.push({
              command: cmd.name,
              agent: agents[agent].name,
              result: { success: true, path: '', mode: installMode, skipped: true },
            });
            continue;
          }
        }

        const result = await installCommandForAgent(cmd, agent, {
          global: isGlobal,
          mode: installMode,
        });
        results.push({ command: cmd.name, agent: agents[agent].name, result });
      }
    }

    installSpinner.stop('Installation complete');

    // Step 8: Report results
    const failed = results.filter((r) => !r.result.success && !r.result.skipped);
    const skipped = results.filter((r) => r.result.skipped);
    const succeeded = results.filter((r) => r.result.success && !r.result.skipped);

    if (succeeded.length > 0) {
      p.log.success(
        `${pc.green(succeeded.length.toString())} command(s) installed successfully`
      );
    }
    if (skipped.length > 0) {
      p.log.info(`${pc.yellow(skipped.length.toString())} command(s) skipped`);
    }
    if (failed.length > 0) {
      p.log.error(`${pc.red(failed.length.toString())} command(s) failed to install`);
      for (const f of failed) {
        p.log.error(`  ${pc.red(`${f.command} → ${f.agent}`)}: ${f.result.error}`);
      }
    }

    // Show where commands were installed
    if (succeeded.length > 0) {
      const canonicalDir =
        isGlobal
          ? join(process.env.HOME || '~', '.agents', 'commands')
          : join(process.cwd(), '.agents', 'commands');
      p.log.info(`Commands installed to: ${pc.cyan(canonicalDir)}`);
    }
  } finally {
    // Cleanup temp directory
    if (tempDir) {
      try {
        await cleanupTempDir(tempDir);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Prompt user for global vs project scope.
 */
async function promptForScope(): Promise<boolean> {
  const scope = await p.select({
    message: 'Install commands globally or in this project?',
    options: [
      { value: 'project', label: 'Project', hint: `./.agents/commands` },
      { value: 'global', label: 'Global', hint: `~/.agents/commands` },
    ],
  });

  if (isCancelled(scope)) {
    p.cancel('Installation cancelled');
    process.exit(0);
  }

  return scope === 'global';
}
```

- [ ] **Step 2: 提交**

```bash
git add src/commands-add.ts
git commit -m "feat(commands): add core add command logic

Parse source, discover commands, select agents, and execute installation.
Supports both local paths and git repos as sources."
```

---

### Task 4: commands-cli.ts - CLI 入口和命令路由

**Files:**
- Create: `src/commands-cli.ts`

**Responsibility:** 解析 `process.argv`，路由到 `runCommandsAdd()`，显示帮助信息。

- [ ] **Step 1: 编写 commands-cli.ts**

```ts
// src/commands-cli.ts
import pc from 'picocolors';
import { runCommandsAdd, parseCommandsAddOptions } from './commands-add.ts';
import { VERSION } from './constants.ts';

const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function showHelp(): void {
  console.log(`
${BOLD}commandsh${RESET} - Install slash commands for AI coding agents

${BOLD}USAGE:${RESET}
  ${BOLD}commandsh add <source>${RESET} [options]

${BOLD}SOURCES:${RESET}
  GitHub shorthand:    owner/repo
  GitHub URL:          https://github.com/owner/repo
  Local path:          ./my-commands or /absolute/path

${BOLD}OPTIONS:${RESET}
  -g, --global         Install globally (~/.agents/commands)
  -y, --yes            Skip prompts, install all
  --command <cmds>     Install specific commands (comma-separated, or * for all)
  --agent <agents>     Install to specific agents (comma-separated, or * for all)
  --copy               Use copy mode instead of symlink
  --all                Install all commands
  -h, --help           Show this help
  -v, --version        Show version

${BOLD}EXAMPLES:${RESET}
  ${pc.dim('$')} commandsh add my-commands-repo
  ${pc.dim('$')} commandsh add owner/commands-repo -g -y
  ${pc.dim('$')} commandsh add ./my-local-commands --command deploy,review
`);
}

function showLogo(): void {
  // Simple text logo
  console.log(`${pc.cyan('⌘')} ${pc.dim('commandsh')} ${pc.dim(`v${VERSION}`)}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    showLogo();
    console.log();
    showHelp();
    return;
  }

  const command = args[0];
  const restArgs = args.slice(1);

  switch (command) {
    case 'add':
    case 'a': {
      showLogo();
      console.log();
      const { source, options } = parseCommandsAddOptions(restArgs);
      await runCommandsAdd(source, options);
      break;
    }
    case '--help':
    case '-h':
      showHelp();
      break;
    case '--version':
    case '-v':
      console.log(VERSION);
      break;
    default:
      console.log(`Unknown command: ${command}`);
      console.log(`Run ${BOLD}commandsh --help${RESET} for usage.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: 提交**

```bash
git add src/commands-cli.ts
git commit -m "feat(commands): add CLI entry point and command routing

Route 'add' command, show help and version info."
```

---

### Task 5: bin/commands.mjs - CLI 入口文件

**Files:**
- Create: `bin/commands.mjs`
- Modify: `package.json`

**Responsibility:** Node.js 入口点，启用编译缓存后导入构建产物。

- [ ] **Step 1: 创建 bin/commands.mjs**

```mjs
#!/usr/bin/env node

import module from 'node:module';

if (module.enableCompileCache && !process.env.NODE_DISABLE_COMPILE_CACHE) {
  try {
    module.enableCompileCache();
  } catch {
    // Ignore errors
  }
}

await import('../dist/commands-cli.mjs');
```

- [ ] **Step 2: 修改 package.json**

在 `bin` 对象中添加：
```json
"commandsh": "./bin/commands.mjs",
"add-command": "./bin/commands.mjs"
```

在 `keywords` 数组中添加：
```json
"slash-commands",
"commands",
"claude-commands",
"cursor-commands"
```

- [ ] **Step 3: 构建并验证**

```bash
pnpm build
```

验证入口可用：
```bash
node bin/commands.mjs --help
```

- [ ] **Step 4: 提交**

```bash
git add bin/commands.mjs package.json
git commit -m "feat(commands): add commandsh bin entry and update package.json

Add commandsh and add-command bin entries.
Add slash-commands related keywords."
```

---

### Task 6: commands-add.test.ts - Add 命令集成测试

**Files:**
- Create: `tests/commands-add.test.ts`

**Responsibility:** 测试 `parseCommandsAddOptions` 和 `runCommandsAdd` 的核心行为。

- [ ] **Step 1: 编写测试**

```ts
// tests/commands-add.test.ts
import { describe, it, expect } from 'vitest';
import { parseCommandsAddOptions } from '../src/commands-add.ts';

describe('parseCommandsAddOptions', () => {
  it('parses source from first positional arg', () => {
    const { source, options } = parseCommandsAddOptions(['my-repo']);
    expect(source).toBe('my-repo');
    expect(options.global).toBeUndefined();
  });

  it('parses --global flag', () => {
    const { options } = parseCommandsAddOptions(['my-repo', '-g']);
    expect(options.global).toBe(true);
  });

  it('parses --global long flag', () => {
    const { options } = parseCommandsAddOptions(['my-repo', '--global']);
    expect(options.global).toBe(true);
  });

  it('parses --yes flag', () => {
    const { options } = parseCommandsAddOptions(['my-repo', '-y']);
    expect(options.yes).toBe(true);
  });

  it('parses --all flag', () => {
    const { options } = parseCommandsAddOptions(['my-repo', '--all']);
    expect(options.all).toBe(true);
  });

  it('parses --agent with comma-separated values', () => {
    const { options } = parseCommandsAddOptions(['my-repo', '--agent', 'claude-code,cursor']);
    expect(options.agent).toEqual(['claude-code', 'cursor']);
  });

  it('parses --agent with wildcard', () => {
    const { options } = parseCommandsAddOptions(['my-repo', '--agent', '*']);
    expect(options.agent).toEqual(['*']);
  });

  it('parses --command with comma-separated values', () => {
    const { options } = parseCommandsAddOptions(['my-repo', '--command', 'deploy,review']);
    expect(options.command).toEqual(['deploy', 'review']);
  });

  it('parses --copy flag', () => {
    const { options } = parseCommandsAddOptions(['my-repo', '--copy']);
    expect(options.copy).toBe(true);
  });

  it('parses multiple flags together', () => {
    const { source, options } = parseCommandsAddOptions([
      'owner/repo',
      '-g',
      '-y',
      '--agent',
      '*',
      '--command',
      'deploy',
    ]);
    expect(source).toBe('owner/repo');
    expect(options.global).toBe(true);
    expect(options.yes).toBe(true);
    expect(options.agent).toEqual(['*']);
    expect(options.command).toEqual(['deploy']);
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
pnpm test tests/commands-add.test.ts
```

- [ ] **Step 3: 提交**

```bash
git add tests/commands-add.test.ts
git commit -m "test(commands): add parseCommandsAddOptions tests

Verify option parsing for global, yes, agent, command, copy flags."
```

---

### Task 7: 运行完整测试套件并构建

**Responsibility:** 确保所有新测试通过，构建成功，且不影响现有功能。

- [ ] **Step 1: 运行所有 commands 测试**

```bash
pnpm test tests/commands-add.test.ts tests/commands-discovery.test.ts tests/commands-installer.test.ts
```

- [ ] **Step 2: 运行所有现有测试确保未破坏**

```bash
pnpm test
```

- [ ] **Step 3: 类型检查**

```bash
pnpm type-check
```

- [ ] **Step 4: 格式化**

```bash
pnpm format
```

- [ ] **Step 5: 构建**

```bash
pnpm build
```

- [ ] **Step 6: 手动验证**

```bash
# 确认 help 输出
node bin/commands.mjs --help

# 确认 version
node bin/commands.mjs --version

# 确认 skills CLI 仍然正常
pnpm dev --help
```

- [ ] **Step 7: 最终提交**

```bash
git add -A
git commit -m "chore(commands): verify build and all tests pass

All new command installation tests passing.
Existing tests unaffected."
```

---

## 注意事项

1. **不修改任何现有 `.ts` 文件**（只有 `package.json` 需要修改添加 bin 和 keywords）
2. **复用现有的 `source-parser.ts`、`git.ts`、`agents.ts`、`constants.ts`、`types.ts`**，只 import 不修改
3. **commands 目录结构是扁平的**：只扫描 `commands/` 目录顶层的 `*.md` 文件
4. **不实现 lock 文件、check、update** - 这些是后续功能
5. **Agent commands 目录映射**初始只包含 claude-code、cursor、cline，后续可按需扩展
6. **sanitizeCommandName** 参考 `sanitizeName` 在 installer.ts 中的实现模式
