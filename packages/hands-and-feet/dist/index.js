// src/index.ts
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
var cli = yargs(hideBin(process.argv)).scriptName("hands-and-feet").usage("$0 <command> [options]").strict().help();
var commands = [
  import("./init-VGHZ675J.js"),
  import("./serve-ZXSGTVAI.js"),
  import("./pause-ZYNHIK6V.js"),
  import("./resume-RKQ774EW.js"),
  import("./status-EUGKH5H2.js")
];
var mods = await Promise.all(commands);
for (const mod of mods) {
  cli.command(mod.default);
}
cli.demandCommand(1, "Please specify a command").argv;
