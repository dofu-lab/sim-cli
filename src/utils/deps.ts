import { existsSync } from "node:fs";
import { join } from "node:path";

export interface ParsedDeps {
  /** e.g. ['accordion', 'button', 'icon'] extracted from @spartan-ng/helm/* */
  spartanHelm: string[];
  /** e.g. ['@ng-icons/lucide', '@ng-icons/core'] */
  ngIcons: string[];
}

/**
 * Parses the component TypeScript source and extracts all
 * @spartan-ng/helm/* and @ng-icons/* import paths.
 */
export function parseDeps(content: string): ParsedDeps {
  const spartanHelmSet = new Set<string>();
  const ngIconsSet = new Set<string>();

  // Match: from '@spartan-ng/helm/accordion'
  const spartanRegex = /from\s+['"]@spartan-ng\/helm\/([a-z0-9-]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = spartanRegex.exec(content)) !== null) {
    spartanHelmSet.add(match[1]);
  }

  // Match: from '@ng-icons/core' or '@ng-icons/lucide'
  const ngIconsRegex = /from\s+['"](@ng-icons\/[a-z0-9-]+)['"]/g;
  while ((match = ngIconsRegex.exec(content)) !== null) {
    ngIconsSet.add(match[1]);
  }

  return {
    spartanHelm: [...spartanHelmSet],
    ngIcons: [...ngIconsSet],
  };
}

export type PackageManager = "pnpm" | "yarn" | "npm";

/**
 * Detects the package manager used in the given directory by inspecting
 * lock files. Falls back to npm.
 */
export function detectPackageManager(cwd: string): PackageManager {
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  return "npm";
}
