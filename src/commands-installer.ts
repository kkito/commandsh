import { mkdir, copyFile, symlink, stat } from 'node:fs/promises';
import { join, dirname, resolve, relative } from 'node:path';
import { homedir } from 'node:os';
import { AGENTS_DIR } from './constants.ts';
import type { AgentType } from './types.ts';
import type { DiscoveredCommand } from './commands-discovery.ts';

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
  cursor: '.cursor/commands',
  cline: '.cline/commands',
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
  // Limit to 255 chars for filesystem safety
  if (sanitized.length > 255) {
    sanitized = sanitized.slice(0, 255);
  }
  return sanitized || 'unnamed';
}

/**
 * Verify that a target path is safely within a base directory.
 */
function isPathSafe(basePath: string, targetPath: string): boolean {
  const resolvedBase = resolve(basePath);
  const resolvedTarget = resolve(targetPath);
  const rel = relative(resolvedBase, resolvedTarget);
  return !rel.startsWith('..') && rel !== '..';
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

    // Verify installed paths are safe (defense in depth)
    if (!isPathSafe(canonicalDir, canonicalPath) || !isPathSafe(agentDir, agentPath)) {
      return {
        success: false,
        path: agentPath,
        mode,
        error: 'Installed command path is outside the allowed directory',
      };
    }

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
