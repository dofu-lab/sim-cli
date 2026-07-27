# @dofu-lab/simui-cli

A small, focused CLI to fetch and inject SimUI Angular components into an existing Angular project.

[![npm version](https://img.shields.io/npm/v/@dofu-lab/simui-cli.svg)](https://www.npmjs.com/package/@dofu-lab/simui-cli)
[![license](https://img.shields.io/npm/l/@dofu-lab/simui-cli.svg)](#license)

This tool fetches component source from the SimUI registry (https://simui.dev/registry), writes the component file into your project, and offers to install any detected dependencies (Spartan UI generators and ng-icons).

Features

- Fetch a component by name and inject it into your project
- Fetch a versioned source snapshot for an exact SpartanNG version
- Detects `@spartan-ng/helm/*` and `@ng-icons/*` imports and offers to install them
- Default output path: `src/app/components` (configurable with `--path`)

Prerequisites

- Node.js >= 18
- An Angular project (CLI available via `ng`)

Installation (local use)

You can run the CLI directly from the built artifact in this repository without publishing to npm:

```bash
cd packages/cli
npm install
npm run build
node dist/index.js add accordion-01
```

Usage

```bash
# Fetch and add a component to the default location
node dist/index.js add accordion-01

# Use the published package (once available)
npx @dofu-lab/simui-cli add accordion-01

# Override output directory
node dist/index.js add badge-01 --path src/shared/ui

# Fetch source compatible with an exact SpartanNG release
npx @dofu-lab/simui-cli add button-01 --spartan-version 1.1.2
```

Commands

- `add <component>` — fetches `<component>` from the registry and writes `<component>.component.ts` to the output directory.

Options

- `-p, --path <dir>` — Output directory relative to the current working directory (default: `src/app/components`).
- `--spartan-version <version>` — Fetch the component and its `@sim/*` dependencies from a versioned registry snapshot for an exact published SpartanNG version.

What the command does

1. Resolves the requested SpartanNG release through the registry manifest, looks up each source file in the release index, and fetches its immutable content-addressed blob. When no version is supplied, the manifest's latest release is used.
2. Writes the TypeScript component file to the chosen output path.
3. Parses the source for `@spartan-ng/helm/*` and `@ng-icons/*` imports.
4. Prompts to install dependencies. Spartan packages are invoked via the Angular generator:

```bash
ng generate @spartan-ng/cli:ui <package>
```

And `@ng-icons/*` packages are installed via your detected package manager (`pnpm`, `yarn`, or `npm`).

Development

```bash
cd packages/cli
npm install
npm test
npm run typecheck
npm run build
# Run the CLI locally
node dist/index.js add select-01
```

Publishing

Follow these steps to publish a new version of this package under the `@dofu-lab` scope.

```bash
cd packages/cli
# bump version (creates a commit + tag)
npm version patch

# build
npm run build

# dry-run
npm publish --dry-run

# publish (scoped public requires --access public)
npm publish --access public

# push commits and tags
git push origin main
git push --tags
```

Contributing

Contributions are welcome. Open issues or pull requests against this repository. For code changes:

1. Fork the repo
2. Create a feature branch
3. Run tests and build locally
4. Submit a pull request

License

This project is licensed under the MIT License — see the `LICENSE` file for details.

Support

If you encounter issues, open an issue on the repository with logs and reproduction steps.
