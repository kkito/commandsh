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

  it('discovers namespaced commands in commands/namespace/name.md', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cmd-discovery-'));
    const commandsDir = join(root, 'commands');
    const awsDir = join(commandsDir, 'aws');
    const azureDir = join(commandsDir, 'azure');
    await mkdir(awsDir, { recursive: true });
    await mkdir(azureDir, { recursive: true });
    await writeFile(join(awsDir, 'deploy.md'), '# AWS Deploy\n');
    await writeFile(join(awsDir, 'review.md'), '# AWS Review\n');
    await writeFile(join(azureDir, 'deploy.md'), '# Azure Deploy\n');

    try {
      const commands = await discoverCommands(root);
      expect(commands).toHaveLength(3);
      expect(commands.map((c) => c.name)).toContain('aws/deploy');
      expect(commands.map((c) => c.name)).toContain('aws/review');
      expect(commands.map((c) => c.name)).toContain('azure/deploy');
      expect(commands[0].path).toMatch(/commands\/aws\/deploy\.md$/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('discovers mixed flat and namespaced commands', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cmd-discovery-'));
    const commandsDir = join(root, 'commands');
    const nsDir = join(commandsDir, 'k8s');
    await mkdir(nsDir, { recursive: true });
    await writeFile(join(commandsDir, 'deploy.md'), '# Deploy\n');
    await writeFile(join(nsDir, 'apply.md'), '# K8s Apply\n');
    await writeFile(join(nsDir, 'status.md'), '# K8s Status\n');

    try {
      const commands = await discoverCommands(root);
      expect(commands).toHaveLength(3);
      expect(commands.map((c) => c.name)).toContain('deploy');
      expect(commands.map((c) => c.name)).toContain('k8s/apply');
      expect(commands.map((c) => c.name)).toContain('k8s/status');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('ignores non-.md files in namespaced directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cmd-discovery-'));
    const commandsDir = join(root, 'commands');
    const nsDir = join(commandsDir, 'aws');
    await mkdir(nsDir, { recursive: true });
    await writeFile(join(nsDir, 'deploy.md'), '# Deploy\n');
    await writeFile(join(nsDir, 'README.txt'), 'Readme\n');
    await writeFile(join(nsDir, 'config.json'), '{}');

    try {
      const commands = await discoverCommands(root);
      expect(commands).toHaveLength(1);
      expect(commands[0].name).toBe('aws/deploy');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('ignores deeply nested files beyond one level', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cmd-discovery-'));
    const commandsDir = join(root, 'commands');
    const deepDir = join(commandsDir, 'aws', 'ec2');
    await mkdir(deepDir, { recursive: true });
    await writeFile(join(deepDir, 'deploy.md'), '# Deep Deploy\n');

    try {
      const commands = await discoverCommands(root);
      expect(commands).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
