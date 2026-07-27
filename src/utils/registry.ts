const SIMUI_ORIGIN = "https://simui.dev";
const LEGACY_REGISTRY_BASE_URL = `${SIMUI_ORIGIN}/registry`;
const REGISTRY_MANIFEST_URL = `${LEGACY_REGISTRY_BASE_URL}/manifest.json`;
const SUPPORTED_REGISTRY_MANIFEST_SCHEMA_VERSIONS = new Set([1, 2, 3, 4, 5]);
const EXACT_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const REGISTRY_PATH_PATTERN =
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/;
const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/;

export interface RegistryComponent {
  content: string;
}

interface RegistryManifest {
  schemaVersion: number;
  latest: string;
  releases: RegistryRelease[];
}

interface RegistryRelease {
  version: string;
  basePath?: string;
  indexPath?: string;
  components: string[];
}

export interface RegistryContext {
  baseUrl: string;
  spartanVersion?: string;
  components?: ReadonlySet<string>;
  files?: ReadonlyMap<string, string>;
}

export const legacyRegistryContext: RegistryContext = {
  baseUrl: LEGACY_REGISTRY_BASE_URL,
};

export async function resolveRegistryContext(
  spartanVersion?: string,
): Promise<RegistryContext> {
  if (
    spartanVersion !== undefined &&
    !EXACT_VERSION_PATTERN.test(spartanVersion)
  ) {
    throw new Error(
      `Invalid SpartanNG version "${spartanVersion}". Use an exact version such as "1.1.2".`,
    );
  }

  const manifest = await fetchRegistryManifest();
  if (spartanVersion === undefined && manifest.schemaVersion < 5) {
    return legacyRegistryContext;
  }

  const selectedVersion = spartanVersion ?? manifest.latest;
  const release = manifest.releases.find(
    ({ version }) => version === selectedVersion,
  );
  if (!release) {
    const availableVersions = manifest.releases
      .map(({ version }) => version)
      .join(", ");
    throw new Error(
      `SpartanNG version "${selectedVersion}" is not published in the SimUI registry.` +
        (availableVersions ? ` Available versions: ${availableVersions}.` : ""),
    );
  }

  if (release.indexPath) {
    return {
      baseUrl: `${SIMUI_ORIGIN}/registry`,
      spartanVersion: selectedVersion,
      components: new Set(release.components),
      files: await fetchReleaseIndex(release),
    };
  }

  return {
    baseUrl: `${SIMUI_ORIGIN}${release.basePath}`,
    spartanVersion: selectedVersion,
    components: new Set(release.components),
  };
}

export async function fetchComponent(
  name: string,
  context: RegistryContext = legacyRegistryContext,
): Promise<string> {
  if (
    context.spartanVersion &&
    context.components &&
    !context.components.has(name)
  ) {
    throw new Error(
      `Component "${name}" is not available for SpartanNG ${context.spartanVersion}.\n` +
        `Browse available components at https://simui.dev`,
    );
  }
  return fetchRegistryContent(name, "Component", context);
}

export async function fetchRegistryContent(
  registryPath: string,
  label: string = "File",
  context: RegistryContext = legacyRegistryContext,
): Promise<string> {
  let url: string;
  if (context.files) {
    const hash = context.files.get(registryPath);
    if (!hash) {
      throw registryNotFound(label, registryPath);
    }
    url = `${context.baseUrl}/blobs/${hash.slice(0, 2)}/${hash}.json`;
  } else {
    url = `${context.baseUrl}/${registryPath}.json`;
  }

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error(`Network error: could not reach ${url}`);
  }
  if (!response.ok) {
    if (response.status === 404 || response.status >= 500) {
      throw registryNotFound(label, registryPath);
    }
    throw new Error(
      `Failed to fetch "${registryPath}" (HTTP ${response.status})`,
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Invalid response from registry for "${registryPath}"`);
  }
  if (!isRecord(data) || typeof data.content !== "string") {
    throw new Error(
      `Unexpected registry format for "${registryPath}" — expected { content: string }`,
    );
  }
  return data.content;
}

async function fetchRegistryManifest(): Promise<RegistryManifest> {
  let response: Response;
  try {
    response = await fetch(REGISTRY_MANIFEST_URL);
  } catch {
    throw new Error(`Network error: could not reach ${REGISTRY_MANIFEST_URL}`);
  }
  if (!response.ok) {
    throw new Error(
      `Could not load the SimUI registry manifest (HTTP ${response.status}).`,
    );
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error(
      "The SimUI registry manifest contains invalid JSON or data.",
    );
  }
  return validateRegistryManifest(value);
}

async function fetchReleaseIndex(
  release: RegistryRelease,
): Promise<ReadonlyMap<string, string>> {
  const url = `${SIMUI_ORIGIN}${release.indexPath}`;
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error(`Network error: could not reach ${url}`);
  }
  if (!response.ok) {
    throw new Error(
      `Could not load the SimUI registry index for SpartanNG ${release.version} (HTTP ${response.status}).`,
    );
  }
  const value: unknown = await response.json();
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.version !== release.version ||
    !isRecord(value.files)
  ) {
    throw new Error(
      `The SimUI registry index for SpartanNG ${release.version} is malformed.`,
    );
  }
  const files = new Map<string, string>();
  for (const [registryPath, hash] of Object.entries(value.files)) {
    if (
      !REGISTRY_PATH_PATTERN.test(registryPath) ||
      typeof hash !== "string" ||
      !CONTENT_HASH_PATTERN.test(hash)
    ) {
      throw new Error(
        `The SimUI registry index for SpartanNG ${release.version} is malformed.`,
      );
    }
    files.set(registryPath, hash);
  }
  return files;
}

function validateRegistryManifest(value: unknown): RegistryManifest {
  if (
    !isRecord(value) ||
    typeof value.schemaVersion !== "number" ||
    !SUPPORTED_REGISTRY_MANIFEST_SCHEMA_VERSIONS.has(value.schemaVersion)
  ) {
    throw new Error(
      "Unsupported SimUI registry manifest. Expected schema version 1, 2, 3, 4, or 5.",
    );
  }
  if (
    typeof value.latest !== "string" ||
    !Array.isArray(value.releases) ||
    value.releases.length === 0
  ) {
    throw new Error("The SimUI registry manifest is malformed.");
  }
  const schemaVersion = value.schemaVersion;
  const releases = value.releases.map((release) =>
    validateRegistryRelease(release, schemaVersion),
  );
  if (!releases.some(({ version }) => version === value.latest)) {
    throw new Error(
      "The SimUI registry manifest has an unpublished latest version.",
    );
  }
  return { schemaVersion, latest: value.latest, releases };
}

function validateRegistryRelease(
  value: unknown,
  schemaVersion: number,
): RegistryRelease {
  if (
    !isRecord(value) ||
    typeof value.version !== "string" ||
    !EXACT_VERSION_PATTERN.test(value.version) ||
    !Array.isArray(value.components) ||
    !value.components.every((component) => typeof component === "string")
  ) {
    throw new Error(
      "The SimUI registry manifest contains a malformed release.",
    );
  }
  if (schemaVersion === 5) {
    if (value.indexPath !== `/registry/releases/${value.version}.json`) {
      throw new Error(
        "The SimUI registry manifest contains a malformed release.",
      );
    }
    return {
      version: value.version,
      indexPath: value.indexPath,
      components: value.components,
    };
  }
  if (value.basePath !== `/registry/versions/${value.version}`) {
    throw new Error(
      "The SimUI registry manifest contains a malformed release.",
    );
  }
  return {
    version: value.version,
    basePath: value.basePath,
    components: value.components,
  };
}

function registryNotFound(label: string, registryPath: string): Error {
  return new Error(
    `${label} "${registryPath}" was not found in the SimUI registry.\n` +
      `Browse available components at https://simui.dev`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
