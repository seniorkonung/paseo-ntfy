import type { PluginClientContext, PluginComposerPillProps } from "@getpaseo/plugin/client";
import { useCallback, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { isNtfyEnabled, setAgentNtfyRpc } from "../shared/ntfy";

const enabledByAgent = new Map<string, boolean>();
const listenersByAgent = new Map<string, Set<() => void>>();

function setEnabled(agentId: string, enabled: boolean): void {
  if (enabledByAgent.get(agentId) === enabled) return;
  enabledByAgent.set(agentId, enabled);
  for (const listener of listenersByAgent.get(agentId) ?? []) listener();
}

function removeEnabled(agentId: string): void {
  if (!enabledByAgent.delete(agentId)) return;
  for (const listener of listenersByAgent.get(agentId) ?? []) listener();
}

export function NtfyPill({ agentId, theme }: PluginComposerPillProps) {
  const subscribe = useCallback(
    (listener: () => void) => {
      const listeners = listenersByAgent.get(agentId) ?? new Set<() => void>();
      listeners.add(listener);
      listenersByAgent.set(agentId, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) listenersByAgent.delete(agentId);
      };
    },
    [agentId],
  );
  const getSnapshot = useCallback(() => enabledByAgent.get(agentId) ?? false, [agentId]);
  const enabled = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const color = enabled ? theme.colors.accent : theme.colors.foregroundMuted;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        opacity: enabled ? 1 : 0.6,
      }}
    >
      <Text style={{ fontSize: 15 }} accessibilityElementsHidden>
        🔔
      </Text>
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
    removeEnabled(agentId);
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
    if ("labels" in agent) {
      setEnabled(
        agent.id,
        isNtfyEnabled((agent as { labels?: Readonly<Record<string, string>> }).labels),
      );
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
        setEnabled(agent.id, !isNtfyEnabled(fresh.agent.labels));
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
    for (const agentId of pills.keys()) removeEnabled(agentId);
    pills.clear();
  };
}
