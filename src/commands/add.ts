import * as p from "@clack/prompts";
import chalk from "chalk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { execSync } from "node:child_process";
import { fetchComponent, fetchRegistryContent } from "../utils/registry.js";
import { detectPackageManager, parseDeps, parseSimImports } from "../utils/deps.js";

export interface AddOptions {
  /** Override output directory (relative to cwd) */
  path?: string;
}

export async function addComponent(
  componentName: string,
  options: AddOptions,
): Promise<void> {
  const cwd = process.cwd();

  // Find the project root to run installs in. Prefer a folder that contains
  // `package.json` or `angular.json`, starting from the output directory and
  // walking upward. Fallback to the current working directory.
  function findProjectRoot(startPath: string): string | null {
    let dir = resolve(startPath);
    const root = dirname(dir);
    // walk up until filesystem root
    while (true) {
      const pkgPath = join(dir, "package.json");
      const ngPath = join(dir, "angular.json");
      if (existsSync(pkgPath) || existsSync(ngPath)) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }

  function readComponentsConfig(projectRoot: string): { componentsPath: string } | null {
    const configPath = join(projectRoot, "components.json");
    if (!existsSync(configPath)) {
      return null;
    }

    try {
      const raw = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw) as { componentsPath?: unknown };
      if (typeof parsed.componentsPath !== "string" || !parsed.componentsPath.trim()) {
        return null;
      }
      return { componentsPath: parsed.componentsPath };
    } catch {
      return null;
    }
  }

  function extractRelativeImports(fileContent: string): string[] {
    const imports = new Set<string>();
    const regex =
      /(from\s+['"](\.{1,2}\/[^'"]+)['"])|(import\s+['"](\.{1,2}\/[^'"]+)['"])|(export\s+\*\s+from\s+['"](\.{1,2}\/[^'"]+)['"])/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(fileContent)) !== null) {
      const value = match[2] ?? match[4] ?? match[6];
      if (value) imports.add(value);
    }
    return [...imports];
  }

  function normalizeRegistryPath(filePath: string): string {
    const withoutExt = filePath.replace(/\.ts$/i, "");
    const segments = withoutExt.split("/").filter(Boolean);
    return segments.join("/");
  }

  function getRegistryCandidates(baseDir: string, importPath: string): string[] {
    const resolved = normalizeRegistryPath(posix.normalize(posix.join(baseDir, importPath)));
    if (/\.[a-z]+$/i.test(importPath)) {
      return [resolved];
    }
    return [resolved, normalizeRegistryPath(posix.join(resolved, "index"))];
  }

  async function fetchSimModuleFiles(moduleName: string): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    const queue: Array<{ path: string; optional: boolean }> = [
      { path: `sim/${moduleName}/index`, optional: false },
    ];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const next = queue.shift();
      if (!next || visited.has(next.path)) continue;
      visited.add(next.path);

      let content: string;
      try {
        content = await fetchRegistryContent(next.path, "Sim file");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (next.optional && message.includes("was not found")) {
          continue;
        }
        throw error;
      }
      files.set(next.path, content);

      const currentDir = posix.dirname(next.path);
      const relativeImports = extractRelativeImports(content);
      for (const relativeImport of relativeImports) {
        const candidates = getRegistryCandidates(currentDir, relativeImport);
        for (const candidate of candidates) {
          if (!visited.has(candidate)) {
            queue.push({ path: candidate, optional: true });
          }
        }
      }
    }

    return files;
  }

  function writeSimFiles(projectRoot: string, modules: Map<string, Map<string, string>>): number {
    const config = readComponentsConfig(projectRoot);
    const configuredComponentsPath = config?.componentsPath ?? "src/libs/ui";
    const componentsPath = resolve(projectRoot, configuredComponentsPath);
    const libsDir = dirname(componentsPath);
    const simBaseDir = join(libsDir, "sim");
    let written = 0;

    for (const [moduleName, moduleFiles] of modules.entries()) {
      for (const [registryPath, content] of moduleFiles.entries()) {
        const modulePrefix = `sim/${moduleName}/`;
        if (!registryPath.startsWith(modulePrefix)) continue;
        const relativePath = registryPath.slice(modulePrefix.length);
        const destinationFile = join(simBaseDir, moduleName, `${relativePath}.ts`);
        mkdirSync(dirname(destinationFile), { recursive: true });
        writeFileSync(destinationFile, content, "utf-8");
        written++;
      }
    }

    return written;
  }

  function updateTsconfigSimPaths(projectRoot: string, simModules: string[]): void {
    if (simModules.length === 0) return;
    const tsconfigPath = join(projectRoot, "tsconfig.json");
    if (!existsSync(tsconfigPath)) return;

    const tsconfigRaw = readFileSync(tsconfigPath, "utf-8");
    const tsconfig = JSON.parse(tsconfigRaw) as {
      compilerOptions?: { paths?: Record<string, string[]> };
    };

    if (!tsconfig.compilerOptions) tsconfig.compilerOptions = {};
    if (!tsconfig.compilerOptions.paths) tsconfig.compilerOptions.paths = {};

    for (const moduleName of simModules) {
      const key = `@sim/${moduleName}`;
      if (!tsconfig.compilerOptions.paths[key]) {
        tsconfig.compilerOptions.paths[key] = [`./src/libs/sim/${moduleName}/index.ts`];
      }
    }

    writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`, "utf-8");
  }

  p.intro(chalk.bold.cyan(`SimUI`) + chalk.dim(` — adding ${componentName}`));

  // ── 1. Fetch component from registry ─────────────────────────────────────
  const spinner = p.spinner();
  spinner.start("Fetching component from registry…");

  let content: string;
  try {
    content = await fetchComponent(componentName);
    spinner.stop(chalk.green("Component fetched"));
  } catch (err) {
    spinner.stop(chalk.red("Failed to fetch component"));
    p.outro(chalk.red(String(err instanceof Error ? err.message : err)));
    process.exit(1);
  }

  // ── 2. Resolve output path ────────────────────────────────────────────────
  const outputDir = options.path
    ? resolve(cwd, options.path)
    : join(cwd, "src", "app", "components");

  const outputFile = join(outputDir, `${componentName}.component.ts`);

  // Determine where to run dependency installation commands (project root).
  const installCwd = findProjectRoot(outputDir) || cwd;

  // ── 3. Check for existing file ────────────────────────────────────────────
  if (existsSync(outputFile)) {
    const overwrite = await p.confirm({
      message: `${chalk.yellow(outputFile.replace(cwd + "/", ""))} already exists. Overwrite?`,
      initialValue: false,
    });

    if (p.isCancel(overwrite) || !overwrite) {
      p.outro(chalk.dim("Aborted."));
      process.exit(0);
    }
  }

  // ── 4. Write file ─────────────────────────────────────────────────────────
  try {
    mkdirSync(dirname(outputFile), { recursive: true });
    writeFileSync(outputFile, content, "utf-8");
  } catch (err) {
    p.outro(
      chalk.red(
        `Could not write file: ${err instanceof Error ? err.message : err}`,
      ),
    );
    process.exit(1);
  }

  const relativePath = outputFile.replace(cwd + "/", "");
  p.log.success(`Created ${chalk.cyan(relativePath)}`);

  // Pull and write @sim/* sources from registry.
  const { simModules } = parseSimImports(content);
  if (simModules.length > 0) {
    const simSpinner = p.spinner();
    simSpinner.start(`Resolving ${simModules.length} @sim module(s) from registry…`);
    try {
      const simModuleFiles = new Map<string, Map<string, string>>();
      for (const moduleName of simModules) {
        const files = await fetchSimModuleFiles(moduleName);
        simModuleFiles.set(moduleName, files);
      }
      const writtenCount = writeSimFiles(installCwd, simModuleFiles);
      updateTsconfigSimPaths(installCwd, simModules);
      simSpinner.stop(
        chalk.green(`Synced ${writtenCount} sim source file(s) and updated tsconfig paths`),
      );
    } catch (err) {
      simSpinner.stop(chalk.red("Failed to sync @sim sources"));
      p.outro(chalk.red(String(err instanceof Error ? err.message : err)));
      process.exit(1);
    }
  }

  // ── 5. Detect dependencies ────────────────────────────────────────────────
  const { spartanHelm, ngIcons } = parseDeps(content);
  const totalDeps = spartanHelm.length + ngIcons.length;

  if (totalDeps === 0) {
    p.outro(chalk.green("Done! No extra dependencies detected."));
    return;
  }

  p.log.info(chalk.bold("Dependencies detected in this component:"));
  for (const d of spartanHelm) {
    p.log.message(
      `  ${chalk.cyan("@spartan-ng/helm/")}${d}   ${chalk.dim("(via Spartan CLI)")}`,
    );
  }
  for (const d of ngIcons) {
    p.log.message(`  ${chalk.cyan(d)}`);
  }

  const shouldInstall = await p.confirm({
    message: `Install ${totalDeps} dependenc${totalDeps === 1 ? "y" : "ies"} now?`,
    initialValue: true,
  });

  if (p.isCancel(shouldInstall) || !shouldInstall) {
    p.log.warn(
      "Skipped dependency installation. Install them manually before using the component.",
    );
    p.outro(chalk.dim("Done."));
    return;
  }

  const pm = detectPackageManager(installCwd);
  p.log.info(
    `Installing dependencies in ${chalk.bold(installCwd)} using ${chalk.bold(pm)}`,
  );

  // ── 6. Install @spartan-ng/helm/* via Spartan CLI ─────────────────────────
  for (const helmPkg of spartanHelm) {
    const installSpinner = p.spinner();
    installSpinner.start(`Installing @spartan-ng/helm/${helmPkg}…`);
    try {
      // Use the Angular generator provided by the Spartan CLI:
      // `ng generate @spartan-ng/cli:ui <package>`
      execSync(`npx ng generate @spartan-ng/cli:ui ${helmPkg}`, {
        cwd: installCwd,
        stdio: "pipe",
      });
      installSpinner.stop(
        chalk.green(`@spartan-ng/helm/${helmPkg} installed via generator`),
      );
    } catch (err) {
      installSpinner.stop(
        chalk.red(`Failed to install @spartan-ng/helm/${helmPkg}`),
      );
      const stderr =
        err instanceof Error && "stderr" in err
          ? String((err as NodeJS.ErrnoException & { stderr: Buffer }).stderr)
          : "";
      p.log.warn(chalk.dim(stderr.trim() || String(err)));
      p.log.warn(
        `If this fails, try running: ${chalk.bold(`ng generate @spartan-ng/cli:ui ${helmPkg}`)}`,
      );
    }
  }

  // ── 7. Install @ng-icons/* via package manager ────────────────────────────
  if (ngIcons.length > 0) {
    const ngIconsStr = ngIcons.join(" ");
    const installCmd =
      pm === "pnpm"
        ? `pnpm add ${ngIconsStr}`
        : pm === "yarn"
          ? `yarn add ${ngIconsStr}`
          : `npm install ${ngIconsStr}`;

    const installSpinner = p.spinner();
    installSpinner.start(`Installing ${ngIconsStr}…`);
    try {
      execSync(installCmd, { cwd: installCwd, stdio: "pipe" });
      installSpinner.stop(chalk.green(`${ngIconsStr} installed`));
    } catch (err) {
      installSpinner.stop(chalk.red(`Failed to install ${ngIconsStr}`));
      p.log.warn(`Run manually: ${chalk.bold(installCmd)}`);
    }
  }

  p.outro(chalk.green("All done! Your component is ready to use."));
}
