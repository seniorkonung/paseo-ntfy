import type { PluginClientContext, PluginComposerPillProps } from "@getpaseo/plugin/client";
import { useAgent } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";
import { isNtfyEnabled, setAgentNtfyRpc } from "../shared/ntfy";

export function NtfyPill({ agentId, theme }: PluginComposerPillProps) {
  const enabled = useAgent(agentId, (agent) => isNtfyEnabled(agent.labels)) ?? false;
  const color = enabled ? theme.colors.accent : theme.colors.foregroundMuted;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Icon name={enabled ? "BellRing" : "Bell"} size={16} color={color} />
      <Text style={{ color }}>Ntfy</Text>
    </View>
  );
}

interface PillRegistration {
  workspaceId: string;
  remove(): void;
}

export function registerNtfyPills(client: PluginClientContext): () => void {
  const pills = new Map<string, PillRegistration>();
  let stopped = false;

  function remove(agentId: string): void {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  }

  function upsert(agent: {
    id: string;
    workspaceId?: string;
    archivedAt?: string | null;
  }): void {
    if (stopped || !agent.workspaceId || agent.archivedAt) {
      remove(agent.id);
      return;
    }
    const existing = pills.get(agent.id);
    if (existing?.workspaceId === agent.workspaceId) return;
    existing?.remove();

    const workspaceId = agent.workspaceId;
    const removePill = client.addComposerPill({
      id: "ntfy",
      title: "Toggle ntfy notifications for this agent",
      workspaceId,
      agentId: agent.id,
      Component: NtfyPill,
      async onPress() {
        const fresh = await client.paseo.agents.ref(agent.id).refresh();
        if (!fresh) throw new Error("The agent no longer exists.");
        await client.rpc(setAgentNtfyRpc, {
          agentId: agent.id,
          enabled: !isNtfyEnabled(fresh.agent.labels),
        });
      },
    });
    pills.set(agent.id, { workspaceId, remove: removePill });
  }

  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind === "remove") remove(update.agentId);
    else upsert(update.agent);
  });

  void (async () => {
    try {
      let cursor: string | undefined;
      let firstPage = true;
      do {
        const page = await client.paseo.agents.list({
          scope: "active",
          filter: { includeArchived: false },
          page: { limit: 200, ...(cursor ? { cursor } : {}) },
          ...(firstPage ? { subscribe: {} } : {}),
        });
        if (stopped) return;
        for (const { agent } of page.entries) upsert(agent);
        cursor = page.pageInfo.nextCursor ?? undefined;
        firstPage = false;
      } while (cursor);
    } catch (error) {
      console.error(
        "[paseo-ntfy] Could not register composer pills",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  })();

  return () => {
    stopped = true;
    unsubscribe();
    for (const pill of pills.values()) pill.remove();
    pills.clear();
  };
}
