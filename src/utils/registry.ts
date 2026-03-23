const REGISTRY_BASE_URL = "https://simui.dev/registry";

export interface RegistryComponent {
  content: string;
}

export async function fetchComponent(name: string): Promise<string> {
  const url = `${REGISTRY_BASE_URL}/${name}.json`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error(`Network error: could not reach ${url}`);
  }

  if (!response.ok) {
    if (response.status === 404 || response.status >= 500) {
      throw new Error(
        `Component "${name}" was not found in the SimUI registry.\n` +
          `Browse available components at https://simui.dev`,
      );
    }
    throw new Error(`Failed to fetch "${name}" (HTTP ${response.status})`);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Invalid response from registry for "${name}"`);
  }

  if (
    typeof data !== "object" ||
    data === null ||
    !("content" in data) ||
    typeof (data as RegistryComponent).content !== "string"
  ) {
    throw new Error(
      `Unexpected registry format for "${name}" — expected { content: string }`,
    );
  }

  return (data as RegistryComponent).content;
}
