import type { PluginHookAgent } from "@getpaseo/plugin/server";
import {
  currentRequestItems,
  hasOnlyAgentMessages,
  hasRunningSubagent,
  pendingBackgroundTaskIds,
  subagentCallIds,
  type TimelineItem,
} from "./background";
import type { ProviderSubagentSource } from "./provider-subagents";

interface NotifiedPosition {
  length: number;
  lastItem: string;
}

/**
 * Claude Code ends its turn while background work runs and starts a new turn when that work
 * reports back. Only the turn after which nothing is left running means the agent is done.
 */
export class CompletedTurnFilter {
  private readonly notified = new Map<string, NotifiedPosition>();

  constructor(private readonly subagents: ProviderSubagentSource) {}

  async shouldNotify(agent: PluginHookAgent, timeline: readonly TimelineItem[]): Promise<boolean> {
    if (agent.provider !== "claude") return true;

    const items = currentRequestItems(timeline);
    if (pendingBackgroundTaskIds(items).length > 0) return false;
    if (await this.isWaitingForSubagents(agent.id, items)) return false;
    // A finished subagent wakes Claude twice (hand-back, then task notification); the second
    // turn adds nothing new for the user.
    if (this.repeatsLastNotification(agent.id, timeline)) return false;

    this.notified.set(agent.id, {
      length: timeline.length,
      lastItem: JSON.stringify(timeline[timeline.length - 1] ?? null),
    });
    return true;
  }

  forget(agentId: string): void {
    this.notified.delete(agentId);
  }

  stop(): void {
    this.notified.clear();
    this.subagents.close();
  }

  private async isWaitingForSubagents(
    agentId: string,
    items: readonly TimelineItem[],
  ): Promise<boolean> {
    const callIds = subagentCallIds(items);
    if (callIds.length === 0) return false;
    try {
      return hasRunningSubagent(callIds, await this.subagents.list(agentId));
    } catch (error) {
      console.error(
        `[paseo-ntfy] Could not read subagents of agent ${agentId}`,
        error instanceof Error ? error.message : "Unknown error",
      );
      return false;
    }
  }

  private repeatsLastNotification(agentId: string, timeline: readonly TimelineItem[]): boolean {
    const position = this.notified.get(agentId);
    if (!position || position.length === 0 || position.length > timeline.length) return false;
    if (JSON.stringify(timeline[position.length - 1]) !== position.lastItem) return false;
    return hasOnlyAgentMessages(timeline.slice(position.length));
  }
}
