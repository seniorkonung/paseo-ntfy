import type { PluginHookAgent, PluginHookContext, PluginTurnOutcome } from "@getpaseo/plugin/server";
import { isNtfyEnabled } from "../shared/ntfy";
import { paseoAgentDeepLink, publishNtfy, type NtfyNotification } from "./publisher";
import type { NtfySettingsStore } from "./settings";
import { AgentNtfyTracker } from "./tracker";

export type NotificationReason = "completed" | "failed" | "permission";

const MESSAGES: Record<NotificationReason, string> = {
  completed: "Agent finished and is waiting for you.",
  failed: "Agent stopped with an error.",
  permission: "Agent is waiting for your input.",
};

export function reasonForTurnOutcome(outcome: PluginTurnOutcome): NotificationReason | null {
  if (outcome.kind === "completed") return "completed";
  if (outcome.kind === "failed") return "failed";
  return null;
}

export function notificationForAgent(
  agent: PluginHookAgent,
  reason: NotificationReason,
  serverId: string,
): NtfyNotification {
  const title = agent.title?.trim() || shortAgentId(agent.id);
  return {
    title: `Paseo · ${title}`,
    message: MESSAGES[reason],
    click: paseoAgentDeepLink(serverId, agent.id),
  };
}

function shortAgentId(agentId: string): string {
  return agentId.length > 8 ? agentId.slice(0, 8) : agentId;
}

export class NtfyNotificationService {
  constructor(
    private readonly settingsStore: NtfySettingsStore,
    private readonly tracker = new AgentNtfyTracker(),
    private readonly publish = publishNtfy,
  ) {}

  async notify(
    agent: PluginHookAgent,
    reason: NotificationReason,
    context: PluginHookContext,
  ): Promise<void> {
    const stored = await this.settingsStore.read();
    if (!stored.values.topic || !stored.serverId) return;

    try {
      await this.tracker.start(context.paseo);
    } catch (error) {
      console.error("[paseo-ntfy] Could not start the agent label subscription", safeError(error));
    }

    const fresh = await context.paseo.agents.ref(agent.id).refresh();
    if (!fresh) {
      this.tracker.remove(agent.id);
      return;
    }
    this.tracker.update(fresh.agent.id, fresh.agent.labels, fresh.agent.archivedAt ?? null);
    if (!this.tracker.isEnabled(agent.id) || !isNtfyEnabled(fresh.agent.labels)) return;

    try {
      await this.publish(
        stored.values,
        notificationForAgent({ ...agent, title: fresh.agent.title }, reason, stored.serverId),
        { signal: context.signal, timeoutMs: 10_000 },
      );
    } catch (error) {
      console.error(
        `[paseo-ntfy] Notification failed for agent ${agent.id}`,
        safeError(error),
      );
    }
  }

  stop(): void {
    this.tracker.stop();
  }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
