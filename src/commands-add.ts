// src/commands-add.ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { parseSource } from './source-parser.ts';
import { cloneRepo, cleanupTempDir } from './git.ts';
import { discoverCommands } from './commands-discovery.ts';
import {
  installCommandForAgent,
  isCommandInstalled,
  type InstallMode,
} from './commands-installer.ts';
import { detectInstalledAgents, agents } from './agents.ts';
import type { AgentType, ParsedSource } from './types.ts';

export interface CommandsAddOptions {
  global?: boolean;
  agent?: string[];
  yes?: boolean;
  command?: string[];
  all?: boolean;
}

const isCancelled = (value: unknown): value is symbol => typeof value === 'symbol';

/**
 * Build multiselect options with proper typing for clack/prompts.
 */
function buildMultiselectOptions<T>(
  items: T[],
  getValue: (item: T) => string,
  getLabel: (item: T) => string
): Array<{ value: T; label: string }> {
  return items.map((item) => ({
    value: item,
    label: getLabel(item),
  }));
}

/**
 * Parse CLI arguments into CommandsAddOptions.
 */
export function parseCommandsAddOptions(args: string[]): {
  source: string;
  options: CommandsAddOptions;
} {
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
    } else if (arg !== undefined && !arg.startsWith('-') && !source) {
      source = arg as string;
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
    let selectedCommands: typeof commands;
    if (options.command && options.command.includes('*')) {
      selectedCommands = commands;
    } else if (options.command && options.command.length > 0) {
      // Filter by provided command names
      selectedCommands = commands.filter((cmd) =>
        options.command!.some((name) => cmd.name.toLowerCase() === name.toLowerCase())
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
      selectedCommands = selected as typeof commands;
    }

    // Step 4: Agent selection
    let selectedAgents: AgentType[];
    if (options.agent && options.agent.includes('*')) {
      selectedAgents = Object.keys(agents).filter((a) => a !== 'universal') as AgentType[];
    } else if (options.agent && options.agent.length > 0) {
      selectedAgents = options.agent as AgentType[];
    } else {
      // Detect installed agents - show all installed agents
      const installedAgents = await detectInstalledAgents();

      const candidates = installedAgents.length > 0 ? installedAgents : [];

      if (candidates.length === 0) {
        p.log.error('No agents detected.');
        process.exit(1);
      }

      if (options.yes) {
        selectedAgents = candidates;
      } else {
        const agentChoices = buildMultiselectOptions(
          candidates,
          (a) => a,
          (a) => agents[a].displayName || agents[a].name
        );

        const selected = (await p.multiselect({
          message: 'Select agents to install commands to:',
          options: agentChoices as unknown as p.Option<AgentType>[],
          required: true,
        })) as AgentType[] | symbol;

        if (isCancelled(selected)) {
          p.cancel('Installation cancelled');
          process.exit(0);
        }
        selectedAgents = selected as AgentType[];
      }
    }

    // Step 5: Scope selection (global vs project)
    const isGlobal = options.global ?? (await promptForScope());

    // Step 6: Install mode - default to copy for single-file commands
    const installMode: InstallMode = 'copy';

    // Step 6b: Confirmation (skip with -y)
    if (!options.yes) {
      const summaryLines = [
        `${selectedCommands.length} command(s): ${selectedCommands.map((c) => pc.cyan(c.name)).join(', ')}`,
        `${selectedAgents.length} agent(s): ${selectedAgents.map((a) => pc.cyan(agents[a].name)).join(', ')}`,
        `Scope: ${isGlobal ? pc.cyan('global') : pc.cyan('project')}`,
        `Mode: ${pc.cyan(installMode)}`,
      ];
      const proceed = await p.confirm({
        message: `Install ${summaryLines.join('\n  ')}?`,
        initialValue: true,
      });
      if (isCancelled(proceed) || !proceed) {
        p.cancel('Installation cancelled');
        process.exit(0);
      }
    }

    // Step 7: Execute installation
    const results: Array<{
      command: string;
      agent: string;
      result: Awaited<ReturnType<typeof installCommandForAgent>>;
    }> = [];

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
      p.log.success(`${pc.green(succeeded.length.toString())} command(s) installed successfully`);
    }
    if (skipped.length > 0) {
      p.log.info(`${pc.yellow(skipped.length.toString())} command(s) skipped`);
    }
    if (failed.length > 0) {
      p.log.error(`${pc.red(failed.length.toString())} command(s) failed to install`);
      for (const f of failed) {
        p.log.error(`  ${pc.red(`${f.command} \u2192 ${f.agent}`)}: ${f.result.error}`);
      }
    }

    // Show where commands were installed
    if (succeeded.length > 0) {
      const canonicalDir = isGlobal
        ? join(homedir(), '.agents', 'commands')
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
