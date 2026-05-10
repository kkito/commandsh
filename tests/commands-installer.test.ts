// tests/commands-installer.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile, lstat, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { homedir } from 'node:os';
import {
  sanitizeCommandName,
  getCanonicalCommandsDir,
  getAgentCommandsDir,
  installCommandForAgent,
  agentSupportsCommands,
  isCommandInstalled,
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

describe('agentSupportsCommands', () => {
  it('returns true for supported agents', () => {
    expect(agentSupportsCommands('claude-code')).toBe(true);
    expect(agentSupportsCommands('cursor')).toBe(true);
  });

  it('returns false for unsupported agents', () => {
    expect(agentSupportsCommands('copilot')).toBe(false);
    expect(agentSupportsCommands('universal')).toBe(false);
  });
});

describe('getAgentCommandsDir', () => {
  it('returns agent-specific dir for supported agents', () => {
    const result = getAgentCommandsDir('claude-code', false, '/some/project');
    expect(result).toBe(join('/some/project', '.claude', 'commands'));
  });

  it('returns canonical dir for unsupported agents', () => {
    const result = getAgentCommandsDir('universal', false, '/some/project');
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

  it('copies command file to canonical dir in copy mode', async () => {
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const cmdDir = join(root, 'commands');
    await mkdir(cmdDir, { recursive: true });
    const cmdPath = join(cmdDir, 'deploy.md');
    await writeFile(cmdPath, '# Deploy command\nSome content');

    const result = await installCommandForAgent({ name: 'deploy', path: cmdPath }, 'claude-code', {
      cwd: projectDir,
      mode: 'copy',
      global: false,
    });

    expect(result.success).toBe(true);
    const canonicalPath = join(projectDir, '.agents', 'commands', 'deploy.md');
    const content = await readFile(canonicalPath, 'utf-8');
    expect(content).toBe('# Deploy command\nSome content');
  });

  it('creates canonical dir first then symlinks in symlink mode', async () => {
    const projectDir = join(root, 'project2');
    await mkdir(projectDir, { recursive: true });

    const cmdDir = join(root, 'commands2');
    await mkdir(cmdDir, { recursive: true });
    const cmdPath = join(cmdDir, 'review.md');
    await writeFile(cmdPath, '# Review\n');

    const result = await installCommandForAgent({ name: 'review', path: cmdPath }, 'claude-code', {
      cwd: projectDir,
      mode: 'symlink',
      global: false,
    });

    expect(result.success).toBe(true);
    const canonicalPath = join(projectDir, '.agents', 'commands', 'review.md');
    expect(result.canonicalPath).toBe(canonicalPath);

    // Verify the file exists in canonical dir
    const canonicalContent = await readFile(canonicalPath, 'utf-8');
    expect(canonicalContent).toBe('# Review\n');
  });

  it('isCommandInstalled returns true for installed commands', async () => {
    const projectDir = join(root, 'project3');
    await mkdir(projectDir, { recursive: true });

    const cmdDir = join(root, 'commands3');
    await mkdir(cmdDir, { recursive: true });
    const cmdPath = join(cmdDir, 'test-cmd.md');
    await writeFile(cmdPath, '# Test\n');

    await installCommandForAgent({ name: 'test-cmd', path: cmdPath }, 'claude-code', {
      cwd: projectDir,
      mode: 'copy',
      global: false,
    });

    const installed = await isCommandInstalled('test-cmd', 'claude-code', {
      cwd: projectDir,
      global: false,
    });
    expect(installed).toBe(true);
  });

  it('isCommandInstalled returns false for non-installed commands', async () => {
    const projectDir = join(root, 'project4');
    await mkdir(projectDir, { recursive: true });

    const installed = await isCommandInstalled('nonexistent', 'claude-code', {
      cwd: projectDir,
      global: false,
    });
    expect(installed).toBe(false);
  });
});
