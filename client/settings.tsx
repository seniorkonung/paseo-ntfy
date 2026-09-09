import type { PluginClientContext, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  DEFAULT_NTFY_SETTINGS,
  type NtfySettingsValues,
  readNtfySettingsRpc,
  saveNtfySettingsRpc,
  testNtfySettingsRpc,
} from "../shared/ntfy";

type Feedback = { kind: "success" | "error"; message: string } | null;

export function createNtfySettingsScreen(client: Pick<PluginClientContext, "rpc">) {
  return function NtfySettingsScreen({ theme, host, layout }: PluginSurfaceProps) {
    const [revision, setRevision] = useState(0);
    const [draft, setDraft] = useState<NtfySettingsValues>({ ...DEFAULT_NTFY_SETTINGS });
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState<Feedback>(null);

    async function load(): Promise<void> {
      setLoading(true);
      setFeedback(null);
      try {
        const result = await client.rpc(readNtfySettingsRpc, {});
        setRevision(result.revision);
        setDraft(result.values);
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
      // The captured plugin client is stable for this registered screen.
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
        const result = await client.rpc(saveNtfySettingsRpc, {
          revision,
          values: draft,
          serverId: host.id,
        });
        if (result.status === "invalid") {
          setFeedback({ kind: "error", message: result.error });
          return;
        }
        setRevision(result.revision);
        setDraft(result.values);
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
        const result = await client.rpc(testNtfySettingsRpc, {
          values: draft,
          serverId: host.id,
        });
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
    const inputStyle = {
      color: theme.colors.foreground,
      backgroundColor: theme.colors.surface2,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
    } as const;

    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
        contentContainerStyle={{ gap: 18, padding: layout.compact ? 16 : 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 4 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 20, fontWeight: "600" }}>
            Ntfy notifications
          </Text>
          <Text style={{ color: theme.colors.foregroundMuted }}>
            Notifications are sent only when the agent label is exactly ntfy=true.
          </Text>
        </View>

        <Field label="Server URL" hint="The ntfy server root, without a topic path." theme={theme}>
          <TextInput
            accessibilityLabel="Ntfy server URL"
            value={draft.serverUrl}
            placeholder="https://ntfy.sh"
            placeholderTextColor={theme.colors.foregroundMuted}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!disabled}
            style={inputStyle}
            onChangeText={(value) => change("serverUrl", value)}
          />
        </Field>

        <Field label="Topic" hint="Leave empty to disable all notifications." theme={theme}>
          <TextInput
            accessibilityLabel="Ntfy topic"
            value={draft.topic}
            placeholder="paseo-agents"
            placeholderTextColor={theme.colors.foregroundMuted}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!disabled}
            style={inputStyle}
            onChangeText={(value) => change("topic", value)}
          />
        </Field>

        <Field
          label="Access token"
          hint="Optional Bearer token. Stored locally on the Paseo host."
          theme={theme}
        >
          <TextInput
            accessibilityLabel="Ntfy access token"
            value={draft.accessToken}
            placeholder="Optional"
            placeholderTextColor={theme.colors.foregroundMuted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            editable={!disabled}
            style={inputStyle}
            onChangeText={(value) => change("accessToken", value)}
          />
        </Field>

        {loading ? (
          <Text style={{ color: theme.colors.foregroundMuted }}>Loading settings…</Text>
        ) : null}
        {feedback ? (
          <Text
            accessibilityLiveRegion="polite"
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

        <View style={{ flexDirection: layout.compact ? "column" : "row", gap: 10 }}>
          <ActionButton
            label={busy ? "Working…" : "Save"}
            disabled={disabled}
            primary
            theme={theme}
            onPress={() => void save()}
          />
          <ActionButton
            label={busy ? "Working…" : "Send test notification"}
            disabled={disabled}
            theme={theme}
            onPress={() => void sendTest()}
          />
          {!loading && feedback?.kind === "error" ? (
            <ActionButton
              label="Reload"
              disabled={busy}
              theme={theme}
              onPress={() => void load()}
            />
          ) : null}
        </View>
      </ScrollView>
    );
  };
}

function Field({
  label,
  hint,
  theme,
  children,
}: {
  label: string;
  hint: string;
  theme: PluginSurfaceProps["theme"];
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: theme.colors.foreground, fontWeight: "500" }}>{label}</Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{hint}</Text>
      {children}
    </View>
  );
}

function ActionButton({
  label,
  disabled,
  primary = false,
  theme,
  onPress,
}: {
  label: string;
  disabled: boolean;
  primary?: boolean;
  theme: PluginSurfaceProps["theme"];
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{
        opacity: disabled ? 0.55 : 1,
        borderRadius: 8,
        borderWidth: primary ? 0 : 1,
        borderColor: theme.colors.border,
        backgroundColor: primary ? theme.colors.accent : theme.colors.surface2,
        paddingHorizontal: 14,
        paddingVertical: 11,
      }}
    >
      <Text
        style={{
          color: primary ? theme.colors.accentForeground : theme.colors.foreground,
          fontWeight: "600",
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
