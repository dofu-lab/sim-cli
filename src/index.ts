import { Command } from "commander";
import { addComponent } from "./commands/add.js";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pkg = require(join(__dirname, "..", "package.json")) as {
  version: string;
};

const program = new Command();

program
  .name("simui")
  .description("Add SimUI Angular components to your project")
  .version(pkg.version);

program
  .command("add <component>")
  .description(
    "Fetch a SimUI component from the registry and add it to your project",
  )
  .option(
    "-p, --path <path>",
    "Output directory relative to cwd (default: src/app/components)",
  )
  .action(async (component: string, opts: { path?: string }) => {
    await addComponent(component, { path: opts.path });
  });

program.parse(process.argv);
