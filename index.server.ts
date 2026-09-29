import type { PluginServerContext } from "@getpaseo/plugin/server";
import { CompletedTurnFilter } from "./server/completed-turns";
import { setAgentNtfyLabel } from "./server/labels";
import { NtfyNotificationService, reasonForTurnOutcome } from "./server/notifications";
import { DaemonProviderSubagentSource } from "./server/provider-subagents";
import { publishNtfy } from "./server/publisher";
import { NtfySettingsStore, normalizeNtfySettings } from "./server/settings";
import {
  readNtfySettingsRpc,
  saveNtfySettingsRpc,
  setAgentNtfyRpc,
  testNtfySettingsRpc,
} from "./shared/ntfy";

export default function contribute(server: PluginServerContext) {
  const settingsStore = new NtfySettingsStore();
  const notifications = new NtfyNotificationService(settingsStore);
  const completedTurns = new CompletedTurnFilter(new DaemonProviderSubagentSource());

  server.handle(readNtfySettingsRpc, async () => {
    const settings = await settingsStore.read();
    return { revision: settings.revision, values: settings.values };
  });

  server.handle(saveNtfySettingsRpc, async ({ revision, values, serverId }) => {
    try {
      const result = await settingsStore.save(revision, values, serverId);
      if (result.status === "conflict") {
        return {
          status: "conflict" as const,
          revision: result.settings.revision,
          values: result.settings.values,
          error: "Settings changed elsewhere. The latest values have been loaded.",
        };
      }
      return {
        status: "saved" as const,
        revision: result.settings.revision,
        values: result.settings.values,
      };
    } catch (error) {
      return {
        status: "invalid" as const,
        revision,
        error: error instanceof Error ? error.message : "Could not save settings.",
      };
    }
  });

  server.handle(testNtfySettingsRpc, async ({ values }) => {
    try {
      const normalized = normalizeNtfySettings(values);
      if (!normalized.topic) {
        return { ok: false as const, message: "Set a topic before sending a test." };
      }
      await publishNtfy(normalized, {
        title: "Paseo · Test notification",
        message: "Paseo ntfy notifications are configured correctly.",
      });
      return { ok: true as const, message: "Test notification sent." };
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : "Could not send test notification.",
      };
    }
  });

  server.handle(setAgentNtfyRpc, async ({ agentId, enabled }) => {
    await setAgentNtfyLabel(agentId, enabled);
    return { enabled };
  });

  const removeTurnEnded = server.on("agent.turn_ended", async (event, context) => {
    const reason = reasonForTurnOutcome(event.outcome);
    if (reason === "completed") {
      await notifications.notify(event.agent, reason, context, () =>
        completedTurns.shouldNotify(event.agent, event.timeline),
      );
      return;
    }
    completedTurns.forget(event.agent.id);
    if (reason) await notifications.notify(event.agent, reason, context);
  });
  const removePermissionRequested = server.on(
    "agent.permission_requested",
    async (event, context) => {
      completedTurns.forget(event.agent.id);
      await notifications.notify(event.agent, "permission", context);
    },
  );

  return () => {
    removeTurnEnded();
    removePermissionRequested();
    notifications.stop();
    completedTurns.stop();
  };
}
