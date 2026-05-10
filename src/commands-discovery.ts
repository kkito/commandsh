import { readdir, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';

export interface DiscoveredCommand {
  name: string;
  path: string;
}

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
