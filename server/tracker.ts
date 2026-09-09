import type { PluginHookContext } from "@getpaseo/plugin/server";
import { isNtfyEnabled } from "../shared/ntfy";

type PaseoApi = PluginHookContext["paseo"];

export class AgentNtfyTracker {
  private readonly enabledAgentIds = new Set<string>();
  private startPromise: Promise<void> | null = null;
  private unsubscribe: (() => void) | null = null;

  start(paseo: PaseoApi): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.initialize(paseo).catch((error) => {
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.startPromise = null;
      throw error;
    });
    return this.startPromise;
  }

  private async initialize(paseo: PaseoApi): Promise<void> {
    this.unsubscribe = paseo.agents.subscribe((update) => {
      if (update.kind === "remove") {
        this.enabledAgentIds.delete(update.agentId);
        return;
      }
      this.update(update.agent.id, update.agent.labels, update.agent.archivedAt ?? null);
    });

    let cursor: string | undefined;
    let firstPage = true;
    do {
      const page = await paseo.agents.list({
        scope: "active",
        filter: { includeArchived: false },
        page: { limit: 200, ...(cursor ? { cursor } : {}) },
        ...(firstPage ? { subscribe: {} } : {}),
      });
      for (const { agent } of page.entries) {
        this.update(agent.id, agent.labels, agent.archivedAt ?? null);
      }
      cursor = page.pageInfo.nextCursor ?? undefined;
      firstPage = false;
    } while (cursor);
  }

  update(
    agentId: string,
    labels: Readonly<Record<string, string>> | null | undefined,
    archivedAt: string | null = null,
  ): void {
    if (!archivedAt && isNtfyEnabled(labels)) {
      this.enabledAgentIds.add(agentId);
    } else {
      this.enabledAgentIds.delete(agentId);
    }
  }

  remove(agentId: string): void {
    this.enabledAgentIds.delete(agentId);
  }

  isEnabled(agentId: string): boolean {
    return this.enabledAgentIds.has(agentId);
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.startPromise = null;
    this.enabledAgentIds.clear();
  }
}
