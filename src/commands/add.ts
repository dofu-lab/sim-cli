import * as p from "@clack/prompts";
import chalk from "chalk";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { fetchComponent } from "../utils/registry.js";
import { detectPackageManager, parseDeps } from "../utils/deps.js";

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
    mkdirSync(outputDir, { recursive: true });
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
