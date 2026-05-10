// src/commands-cli.ts
import pc from 'picocolors';
import { runCommandsAdd, parseCommandsAddOptions } from './commands-add.ts';

function showHelp(): void {
  console.log(`
${pc.bold('commandsh')} - Install slash commands for AI coding agents

${pc.bold('USAGE:')}
  ${pc.bold('commandsh add <source>')} [options]

${pc.bold('SOURCES:')}
  GitHub shorthand:    owner/repo
  GitHub URL:          https://github.com/owner/repo
  Local path:          ./my-commands or /absolute/path

${pc.bold('OPTIONS:')}
  -g, --global         Install globally (~/.agents/commands)
  -y, --yes            Skip prompts, install all
  --command <cmds>     Install specific commands (comma-separated, or * for all)
  --agent <agents>     Install to specific agents (comma-separated, or * for all)
  --all                Install all commands
  -h, --help           Show this help
  -v, --version        Show version

${pc.bold('EXAMPLES:')}
  ${pc.dim('$')} commandsh add my-commands-repo
  ${pc.dim('$')} commandsh add owner/commands-repo -g -y
  ${pc.dim('$')} commandsh add ./my-local-commands --command deploy,review
`);
}

function showLogo(): void {
  console.log(`${pc.cyan('⌘')} ${pc.dim('commandsh')}`);
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
      console.log('1.5.6');
      break;
    default:
      console.log(`Unknown command: ${command}`);
      console.log(`Run ${pc.bold('commandsh --help')} for usage.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
