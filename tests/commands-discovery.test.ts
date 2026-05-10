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
