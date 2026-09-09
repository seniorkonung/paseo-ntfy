import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsInput,
  SettingsSelect,
  SettingsSection,
} from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import {
  DEFAULT_NTFY_SETTINGS,
  type NtfyPriority,
  type NtfySettingsValues,
  readNtfySettingsRpc,
  saveNtfySettingsRpc,
  testNtfySettingsRpc,
} from "../shared/ntfy";

type Feedback = { kind: "success" | "error"; message: string } | null;

type PriorityValue = "1" | "2" | "3" | "4" | "5";

const PRIORITY_OPTIONS: ReadonlyArray<{ label: string; value: PriorityValue }> = [
  { label: "Minimal (1)", value: "1" },
  { label: "Low (2)", value: "2" },
  { label: "Default (3)", value: "3" },
  { label: "High (4)", value: "4" },
  { label: "Maximum (5)", value: "5" },
];

function parsePriority(value: PriorityValue): NtfyPriority {
  return Number(value) as NtfyPriority;
}

export function NtfySettingsScreen({ theme, host, layout }: PluginSurfaceProps) {
  const readSettings = useRpc(readNtfySettingsRpc);
  const saveSettings = useRpc(saveNtfySettingsRpc);
  const testSettings = useRpc(testNtfySettingsRpc);
  const [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState<NtfySettingsValues>({ ...DEFAULT_NTFY_SETTINGS });
  const [generation, setGeneration] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function load(): Promise<void> {
    setLoading(true);
    setFeedback(null);
    try {
      const result = await readSettings({});
      setRevision(result.revision);
      setDraft(result.values);
      setGeneration((value) => value + 1);
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not load ntfy settings.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // RPC functions are bound to this plugin installation for the component lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function change<Key extends keyof NtfySettingsValues>(
    key: Key,
    value: NtfySettingsValues[Key],
  ): void {
    setDraft((current) => ({ ...current, [key]: value }));
    setFeedback(null);
  }

  async function save(): Promise<void> {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await saveSettings({ revision, values: draft, serverId: host.id });
      if (result.status === "invalid") {
        setFeedback({ kind: "error", message: result.error });
        return;
      }
      setRevision(result.revision);
      setDraft(result.values);
      setGeneration((value) => value + 1);
      setFeedback({
        kind: result.status === "saved" ? "success" : "error",
        message: result.status === "saved" ? "Settings saved." : result.error,
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not save ntfy settings.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function sendTest(): Promise<void> {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await testSettings({ values: draft, serverId: host.id });
      setFeedback({ kind: result.ok ? "success" : "error", message: result.message });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not send a test notification.",
      });
    } finally {
      setBusy(false);
    }
  }

  const disabled = loading || busy;
  return (
    <View
      style={{
        flex: 1,
        gap: 16,
        padding: layout.compact ? 16 : 24,
        backgroundColor: theme.colors.surface0,
      }}
    >
      <SettingsSection
        title="Ntfy connection"
        info="Notifications are sent only for agents whose ntfy label is exactly true."
      >
        <SettingsInput
          key={`server-${generation}`}
          label="Server URL"
          hint="The ntfy server root, without a topic path."
          initialValue={draft.serverUrl}
          placeholder="https://ntfy.sh"
          disabled={disabled}
          onChangeText={(value) => change("serverUrl", value)}
        />
        <SettingsInput
          key={`topic-${generation}`}
          label="Topic"
          hint="Leave empty to disable all notifications."
          initialValue={draft.topic}
          placeholder="paseo-agents"
          disabled={disabled}
          onChangeText={(value) => change("topic", value)}
        />
        <SettingsInput
          key={`token-${generation}`}
          label="Access token"
          hint="Optional Bearer token. Stored locally on the Paseo host."
          initialValue={draft.accessToken}
          placeholder="Optional"
          secureTextEntry
          disabled={disabled}
          onChangeText={(value) => change("accessToken", value)}
        />
        <SettingsSelect
          label="Priority"
          hint="Applied globally to test and agent notifications."
          value={String(draft.priority) as PriorityValue}
          options={PRIORITY_OPTIONS}
          disabled={disabled}
          onValueChange={(value) => change("priority", parsePriority(value))}
        />
      </SettingsSection>

      <SettingsSection title="Actions">
        <SettingsAction
          label="Save configuration"
          actionLabel={busy ? "Working…" : "Save"}
          disabled={disabled}
          onPress={() => void save()}
        />
        <SettingsAction
          label="Verify the current values"
          hint="The draft values above are used; saving first is not required."
          actionLabel={busy ? "Working…" : "Send test notification"}
          disabled={disabled}
          onPress={() => void sendTest()}
        />
        {loading ? (
          <Text style={{ color: theme.colors.foregroundMuted }}>Loading settings…</Text>
        ) : null}
        {feedback ? (
          <Text
            style={{
              color:
                feedback.kind === "success"
                  ? theme.colors.statusSuccess
                  : theme.colors.statusDanger,
            }}
          >
            {feedback.message}
          </Text>
        ) : null}
        {!loading && feedback?.kind === "error" ? (
          <SettingsAction
            label="Reload values from the host"
            actionLabel="Reload"
            disabled={busy}
            onPress={() => void load()}
          />
        ) : null}
      </SettingsSection>
    </View>
  );
}
