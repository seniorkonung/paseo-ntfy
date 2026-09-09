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
      values: { serverUrl: "https://ntfy.sh", topic: "", accessToken: "", priority: 3 },
    });
  });

  it("atomically saves normalized values with private permissions", async () => {
    const path = await temporarySettingsPath();
    const store = new NtfySettingsStore(path);
    const result = await store.save(
      0,
      {
        serverUrl: " https://ntfy.example/// ",
        topic: " paseo_1 ",
        accessToken: " token ",
        priority: 5,
      },
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
          priority: 5,
        },
      },
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(dirname(path))).mode & 0o777).toBe(0o700);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ version: 2, revision: 1 });
  });

  it("returns the latest document on an optimistic revision conflict", async () => {
    const store = new NtfySettingsStore(await temporarySettingsPath());
    await store.save(
      0,
      { serverUrl: "https://ntfy.sh", topic: "one", accessToken: "", priority: 2 },
      "server",
    );
    const conflict = await store.save(
      0,
      { serverUrl: "https://ntfy.sh", topic: "two", accessToken: "", priority: 4 },
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
      normalizeNtfySettings({
        serverUrl: "ftp://ntfy.sh",
        topic: "ok",
        accessToken: "",
        priority: 3,
      }),
    ).toThrow("http:// or https://");
    expect(() =>
      normalizeNtfySettings({
        serverUrl: "https://user:pass@ntfy.sh",
        topic: "ok",
        accessToken: "",
        priority: 3,
      }),
    ).toThrow("must not contain credentials");
    expect(() =>
      normalizeNtfySettings({
        serverUrl: "https://ntfy.sh",
        topic: "not valid",
        accessToken: "",
        priority: 3,
      }),
    ).toThrow("Topic must contain");
  });

  it("migrates version 1 documents to the default priority", async () => {
    const path = await temporarySettingsPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        revision: 7,
        serverId: "server",
        values: {
          serverUrl: "https://ntfy.example",
          topic: "paseo",
          accessToken: "token",
        },
      }),
      "utf8",
    );

    await expect(new NtfySettingsStore(path).read()).resolves.toEqual({
      revision: 7,
      serverId: "server",
      values: {
        serverUrl: "https://ntfy.example",
        topic: "paseo",
        accessToken: "token",
        priority: 3,
      },
    });
  });
});
