import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NtfySettingsStore, normalizeNtfySettings } from "./settings";

const temporaryDirectories: string[] = [];

async function temporarySettingsPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "paseo-ntfy-"));
  temporaryDirectories.push(root);
  return join(root, "plugin-settings", "paseo-ntfy", "ntfy.json");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("NtfySettingsStore", () => {
  it("returns disabled defaults before the first save", async () => {
    const store = new NtfySettingsStore(await temporarySettingsPath());
    await expect(store.read()).resolves.toEqual({
      revision: 0,
      serverId: "",
      values: { serverUrl: "https://ntfy.sh", topic: "", accessToken: "" },
    });
  });

  it("atomically saves normalized values with private permissions", async () => {
    const path = await temporarySettingsPath();
    const store = new NtfySettingsStore(path);
    const result = await store.save(
      0,
      { serverUrl: " https://ntfy.example/// ", topic: " paseo_1 ", accessToken: " token " },
      "server-id",
    );
    expect(result).toEqual({
      status: "saved",
      settings: {
        revision: 1,
        serverId: "server-id",
        values: {
          serverUrl: "https://ntfy.example",
          topic: "paseo_1",
          accessToken: "token",
        },
      },
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(dirname(path))).mode & 0o777).toBe(0o700);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ version: 1, revision: 1 });
  });

  it("returns the latest document on an optimistic revision conflict", async () => {
    const store = new NtfySettingsStore(await temporarySettingsPath());
    await store.save(
      0,
      { serverUrl: "https://ntfy.sh", topic: "one", accessToken: "" },
      "server",
    );
    const conflict = await store.save(
      0,
      { serverUrl: "https://ntfy.sh", topic: "two", accessToken: "" },
      "server",
    );
    expect(conflict.status).toBe("conflict");
    expect(conflict.settings.revision).toBe(1);
    expect(conflict.settings.values.topic).toBe("one");
  });

  it("rejects corrupt files and invalid URLs or topics", async () => {
    const path = await temporarySettingsPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "not-json", "utf8");
    await expect(new NtfySettingsStore(path).read()).rejects.toThrow("not valid JSON");

    expect(() =>
      normalizeNtfySettings({ serverUrl: "ftp://ntfy.sh", topic: "ok", accessToken: "" }),
    ).toThrow("http:// or https://");
    expect(() =>
      normalizeNtfySettings({
        serverUrl: "https://user:pass@ntfy.sh",
        topic: "ok",
        accessToken: "",
      }),
    ).toThrow("must not contain credentials");
    expect(() =>
      normalizeNtfySettings({ serverUrl: "https://ntfy.sh", topic: "not valid", accessToken: "" }),
    ).toThrow("Topic must contain");
  });
});
