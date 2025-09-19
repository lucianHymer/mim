#!/usr/bin/env node

import { coalesce } from './commands/coalesce';
import { distill } from './commands/distill';
import { showHelp } from './commands/help';
import { DistillOptions, Colors } from './types';

/**
 * Parse distill command options
 */
function parseDistillOptions(args: string[]): DistillOptions {
  const options: DistillOptions = {
    noInteractive: false,
    refineOnly: false
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    switch (arg) {
      case '--no-interactive':
      case '-n':
        options.noInteractive = true;
        i++;
        break;
      case '--editor':
        options.customEditor = args[i + 1];
        if (!options.customEditor) {
          console.error(`${Colors.RED}--editor requires a value${Colors.NC}`);
          console.error('Usage: mim distill [--no-interactive|-n] [--editor <command>] [--refine-only]');
          process.exit(1);
        }
        i += 2;
        break;
      case '--refine-only':
        options.refineOnly = true;
        i++;
        break;
      default:
        console.error(`${Colors.RED}Unknown option: ${arg}${Colors.NC}`);
        console.error('Usage: mim distill [--no-interactive|-n] [--editor <command>] [--refine-only]');
        process.exit(1);
    }
  }

  return options;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'coalesce':
      await coalesce();
      break;

    case 'distill':
      const distillOptions = parseDistillOptions(args.slice(1));
      await distill(distillOptions);
      break;

    case 'help':
    case '--help':
    case '-h':
    case undefined:
      showHelp();
      break;

    default:
      console.error(`${Colors.RED}Unknown command: ${command}${Colors.NC}`);
      console.error('');
      showHelp();
      process.exit(1);
  }
}

// Handle uncaught errors gracefully
process.on('uncaughtException', (err) => {
  console.error(`${Colors.RED}Uncaught error: ${err.message}${Colors.NC}`);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error(`${Colors.RED}Unhandled rejection: ${err}${Colors.NC}`);
  process.exit(1);
});

// Run main
main().catch((err) => {
  console.error(`${Colors.RED}Fatal error: ${err.message}${Colors.NC}`);
  process.exit(1);
});