import { readdir, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';

export interface DiscoveredCommand {
  name: string;
  path: string;
}

/**
 * Scan a source directory for commands in the commands/ subdirectory.
 * Supports both flat structure (commands/name.md) and namespaced structure
 * (commands/namespace/name.md). Namespaced commands are returned with the
 * namespace prefix (e.g., "aws/deploy").
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
    const fullPath = join(commandsDir, entry);
    const entryStat = await stat(fullPath);

    // Handle flat structure: commands/*.md
    if (entryStat.isFile() && extname(entry) === '.md') {
      commands.push({
        name: basename(entry, '.md'),
        path: fullPath,
      });
      continue;
    }

    // Handle namespaced structure: commands/namespace/*.md
    if (entryStat.isDirectory()) {
      const namespaceDir = fullPath;
      let nsEntries: string[];
      try {
        nsEntries = await readdir(namespaceDir);
      } catch {
        continue;
      }

      for (const nsEntry of nsEntries) {
        const nsFullPath = join(namespaceDir, nsEntry);
        // Only process .md files, skip subdirectories
        if (!nsFullPath.endsWith('.md')) continue;

        const nsEntryStat = await stat(nsFullPath);
        if (!nsEntryStat.isFile()) continue;

        commands.push({
          name: `${entry}/${basename(nsEntry, '.md')}`,
          path: nsFullPath,
        });
      }
    }
  }

  // Sort by name for consistent output
  commands.sort((a, b) => a.name.localeCompare(b.name));
  return commands;
}
