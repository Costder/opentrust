import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const cli = yargs(hideBin(process.argv))
  .scriptName('hands-body-and-feet')
  .usage('$0 <command> [options]')
  .strict()
  .help();

// Register all commands
const commands = [
  import('./cli/init.js'),
  import('./cli/serve.js'),
  import('./cli/pause.js'),
  import('./cli/resume.js'),
  import('./cli/status.js'),
];

const mods = await Promise.all(commands);
for (const mod of mods) {
  cli.command(mod.default);
}

cli.demandCommand(1, 'Please specify a command').argv;
