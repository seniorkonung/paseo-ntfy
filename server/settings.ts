import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  DEFAULT_NTFY_SETTINGS,
  type NtfySettingsValues,
  ntfySettingsValuesSchema,
} from "../shared/ntfy";

const SETTINGS_VERSION = 1;
const TOPIC_PATTERN = /^[-_A-Za-z0-9]{1,64}$/;

const settingsDocumentSchema = z.object({
  version: z.literal(SETTINGS_VERSION),
  revision: z.number().int().positive(),
  serverId: z.string().min(1),
  values: ntfySettingsValuesSchema,
});

export interface StoredNtfySettings {
  revision: number;
  serverId: string;
  values: NtfySettingsValues;
}

export type SaveSettingsResult =
  | { status: "saved"; settings: StoredNtfySettings }
  | { status: "conflict"; settings: StoredNtfySettings };

export function defaultSettingsPath(): string {
  const paseoHome = process.env.PASEO_HOME?.trim() || join(homedir(), ".paseo");
  return join(paseoHome, "plugin-settings", "paseo-ntfy", "ntfy.json");
}

export function normalizeNtfySettings(values: NtfySettingsValues): NtfySettingsValues {
  const rawServerUrl = values.serverUrl.trim();
  let url: URL;
  try {
    url = new URL(rawServerUrl);
  } catch {
    throw new Error("Server URL must be a valid http:// or https:// URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Server URL must use http:// or https://.");
  }
  if (url.username || url.password) {
    throw new Error("Server URL must not contain credentials; use the access token field.");
  }
  if (url.search || url.hash) {
    throw new Error("Server URL must not contain a query string or fragment.");
  }

  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  const serverUrl = url.toString().replace(/\/$/, "");
  const topic = values.topic.trim();
  if (topic && !TOPIC_PATTERN.test(topic)) {
    throw new Error("Topic must contain 1–64 letters, numbers, hyphens, or underscores.");
  }

  return {
    serverUrl,
    topic,
    accessToken: values.accessToken.trim(),
  };
}

function emptySettings(): StoredNtfySettings {
  return {
    revision: 0,
    serverId: "",
    values: { ...DEFAULT_NTFY_SETTINGS },
  };
}

export class NtfySettingsStore {
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(readonly path = defaultSettingsPath()) {}

  async read(): Promise<StoredNtfySettings> {
    let serialized: string;
    try {
      serialized = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptySettings();
      }
      throw error;
    }

    let json: unknown;
    try {
      json = JSON.parse(serialized);
    } catch {
      throw new Error(`Ntfy settings file is not valid JSON: ${this.path}`);
    }
    const parsed = settingsDocumentSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`Ntfy settings file has an unsupported or invalid format: ${this.path}`);
    }
    return {
      revision: parsed.data.revision,
      serverId: parsed.data.serverId,
      values: normalizeNtfySettings(parsed.data.values),
    };
  }

  async save(
    expectedRevision: number,
    values: NtfySettingsValues,
    serverId: string,
  ): Promise<SaveSettingsResult> {
    const normalized = normalizeNtfySettings(values);
    const cleanServerId = serverId.trim();
    if (!cleanServerId) {
      throw new Error("Paseo server ID is missing.");
    }

    let result: SaveSettingsResult | undefined;
    const operation = this.saveQueue.then(async () => {
      const current = await this.read();
      if (current.revision !== expectedRevision) {
        result = { status: "conflict", settings: current };
        return;
      }

      const settings: StoredNtfySettings = {
        revision: current.revision + 1,
        serverId: cleanServerId,
        values: normalized,
      };
      await this.writeAtomic(settings);
      result = { status: "saved", settings };
    });
    this.saveQueue = operation.catch(() => {});
    await operation;
    return result!;
  }

  private async writeAtomic(settings: StoredNtfySettings): Promise<void> {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const temporaryPath = join(directory, `.ntfy-${process.pid}-${randomUUID()}.tmp`);
    const document = JSON.stringify(
      {
        version: SETTINGS_VERSION,
        revision: settings.revision,
        serverId: settings.serverId,
        values: settings.values,
      },
      null,
      2,
    );
    try {
      const file = await open(temporaryPath, "wx", 0o600);
      try {
        await file.writeFile(`${document}\n`, "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporaryPath, this.path);
      await chmod(this.path, 0o600);
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      throw error;
    }
  }
}
