import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const NTFY_LABEL = "ntfy";
export const NTFY_ENABLED_VALUE = "true";
export const NTFY_DISABLED_VALUE = "false";
export const DEFAULT_NTFY_SERVER_URL = "https://ntfy.sh";

export const ntfySettingsValuesSchema = z.object({
  serverUrl: z.string(),
  topic: z.string(),
  accessToken: z.string(),
});

export type NtfySettingsValues = z.infer<typeof ntfySettingsValuesSchema>;

export const DEFAULT_NTFY_SETTINGS: NtfySettingsValues = {
  serverUrl: DEFAULT_NTFY_SERVER_URL,
  topic: "",
  accessToken: "",
};

const settingsSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  values: ntfySettingsValuesSchema,
});

export const readNtfySettingsRpc = defineRpc({
  name: "ntfy.settings.read",
  input: z.object({}),
  output: settingsSnapshotSchema,
});

export const saveNtfySettingsRpc = defineRpc({
  name: "ntfy.settings.save",
  input: z.object({
    revision: z.number().int().nonnegative(),
    values: ntfySettingsValuesSchema,
    serverId: z.string().min(1),
  }),
  output: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("saved"),
      revision: z.number().int().positive(),
      values: ntfySettingsValuesSchema,
    }),
    z.object({
      status: z.literal("conflict"),
      revision: z.number().int().nonnegative(),
      values: ntfySettingsValuesSchema,
      error: z.string(),
    }),
    z.object({
      status: z.literal("invalid"),
      revision: z.number().int().nonnegative(),
      error: z.string(),
    }),
  ]),
});

export const testNtfySettingsRpc = defineRpc({
  name: "ntfy.settings.test",
  input: z.object({
    values: ntfySettingsValuesSchema,
    serverId: z.string().min(1),
  }),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), message: z.string() }),
    z.object({ ok: z.literal(false), message: z.string() }),
  ]),
});

export const setAgentNtfyRpc = defineRpc({
  name: "ntfy.agent.set-enabled",
  input: z.object({
    agentId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
    enabled: z.boolean(),
  }),
  output: z.object({ enabled: z.boolean() }),
});

export function isNtfyEnabled(labels: Readonly<Record<string, string>> | null | undefined): boolean {
  return labels?.[NTFY_LABEL] === NTFY_ENABLED_VALUE;
}

export function ntfyLabelValue(enabled: boolean): string {
  return `${NTFY_LABEL}=${enabled ? NTFY_ENABLED_VALUE : NTFY_DISABLED_VALUE}`;
}
