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

  it('parses --list flag', () => {
    const { options } = parseCommandsAddOptions(['my-repo', '--list']);
    expect(options.list).toBe(true);
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
