import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  fetchComponent,
  fetchRegistryContent,
  resolveRegistryContext,
} from "./registry.js";

const originalFetch = globalThis.fetch;
const componentHash = "a".repeat(64);
const simHash = "b".repeat(64);
const manifest = {
  schemaVersion: 5,
  latest: "1.1.2",
  releases: [
    {
      version: "1.1.2",
      publishedAt: "2026-07-26",
      indexPath: "/registry/releases/1.1.2.json",
      components: ["button-01"],
    },
  ],
  changelog: [
    {
      id: "2026-07-27-version-aware-source",
      date: "2026-07-27",
      spartanVersion: "1.1.2",
      type: "feature",
      title: "Version-aware source",
      description: "Choose source for a supported SpartanUI version.",
    },
  ],
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("versioned registry", () => {
  it("resolves the latest content-addressed release when no version is requested", async () => {
    const requests: string[] = [];
    mockFetch(requests, [
      manifest,
      releaseIndex({ "button-01": componentHash }),
      { content: "latest source" },
    ]);

    const context = await resolveRegistryContext();
    assert.equal(await fetchComponent("button-01", context), "latest source");
    assert.deepEqual(requests, [
      "https://simui.dev/registry/manifest.json",
      "https://simui.dev/registry/releases/1.1.2.json",
      `https://simui.dev/registry/blobs/aa/${componentHash}.json`,
    ]);
  });

  it("uses one versioned index for components and nested Sim files", async () => {
    const requests: string[] = [];
    mockFetch(requests, [
      manifest,
      releaseIndex({
        "button-01": componentHash,
        "sim/color-picker/index": simHash,
      }),
      { content: "component source" },
      { content: "sim source" },
    ]);

    const context = await resolveRegistryContext("1.1.2");
    assert.equal(
      await fetchComponent("button-01", context),
      "component source",
    );
    assert.equal(
      await fetchRegistryContent("sim/color-picker/index", "Sim file", context),
      "sim source",
    );
    assert.deepEqual(requests, [
      "https://simui.dev/registry/manifest.json",
      "https://simui.dev/registry/releases/1.1.2.json",
      `https://simui.dev/registry/blobs/aa/${componentHash}.json`,
      `https://simui.dev/registry/blobs/bb/${simHash}.json`,
    ]);
  });

  it("rejects malformed versions before making a request", async () => {
    const requests: string[] = [];
    mockFetch(requests, []);

    await assert.rejects(
      resolveRegistryContext("latest"),
      /Invalid SpartanNG version "latest"/,
    );
    assert.deepEqual(requests, []);
  });

  it("reports the available releases for an unpublished version", async () => {
    mockFetch([], [manifest]);

    await assert.rejects(
      resolveRegistryContext("1.0.2"),
      /SpartanNG version "1\.0\.2" is not published.*Available versions: 1\.1\.2/,
    );
  });

  it("rejects a component absent from the selected release without fetching it", async () => {
    const requests: string[] = [];
    mockFetch(requests, [
      manifest,
      releaseIndex({ "button-01": componentHash }),
    ]);

    const context = await resolveRegistryContext("1.1.2");
    await assert.rejects(
      fetchComponent("card-01", context),
      /Component "card-01" is not available for SpartanNG 1\.1\.2/,
    );
    assert.deepEqual(requests, [
      "https://simui.dev/registry/manifest.json",
      "https://simui.dev/registry/releases/1.1.2.json",
    ]);
  });

  it("rejects malformed manifest release paths", async () => {
    mockFetch(
      [],
      [
        {
          ...manifest,
          releases: [
            {
              ...manifest.releases[0],
              indexPath: "https://malicious.example/registry",
            },
          ],
        },
      ],
    );

    await assert.rejects(
      resolveRegistryContext("1.1.2"),
      /manifest contains a malformed release/,
    );
  });
});

function releaseIndex(files: Record<string, string>): unknown {
  return { schemaVersion: 1, version: "1.1.2", files };
}

function mockFetch(requests: string[], responses: unknown[]): void {
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    const value = responses.shift();
    if (value === undefined) {
      throw new Error("Unexpected fetch request.");
    }
    return jsonResponse(value);
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
