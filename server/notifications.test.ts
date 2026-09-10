import type { PluginHookAgent, PluginHookContext } from "@getpaseo/plugin/server";
import { describe, expect, it, vi } from "vitest";
import type { NtfySettingsValues } from "../shared/ntfy";
import type { NtfyFetch, NtfyNotification } from "./publisher";
import {
  NtfyNotificationService,
  notificationForAgent,
  reasonForTurnOutcome,
} from "./notifications";
import type { NtfySettingsStore } from "./settings";

const agent: PluginHookAgent = {
  id: "agent-123456789",
  workspaceId: "workspace",
  parentAgentId: null,
  provider: "codex",
  cwd: "/work",
  title: "Checkout agent",
};

describe("lifecycle notification mapping", () => {
  it("notifies for completed and failed turns but not cancellation", () => {
    expect(reasonForTurnOutcome({ kind: "completed" })).toBe("completed");
    expect(reasonForTurnOutcome({ kind: "failed", error: { message: "boom" } })).toBe("failed");
    expect(reasonForTurnOutcome({ kind: "canceled", reason: "manual" })).toBeNull();
  });

  it("uses generic content and a clearing Paseo view action", () => {
    expect(notificationForAgent(agent, "permission", "server/id")).toEqual({
      title: "Paseo · Checkout agent",
      message: "Agent is waiting for your input.",
      actions: [
        {
          action: "view",
          label: "Open session",
          url: "paseo://h/server%2Fid/agent/agent-123456789",
          clear: true,
        },
      ],
    });
    expect(notificationForAgent({ ...agent, title: null }, "failed", "server").title).toBe(
      "Paseo · agent-12",
    );
  });
});

describe("NtfyNotificationService", () => {
  function contextWithLabels(labels: Record<string, string>): PluginHookContext {
    const snapshot = {
      id: agent.id,
      labels,
      title: agent.title,
      archivedAt: null,
    };
    const paseo = {
      agents: {
        subscribe: vi.fn(() => () => {}),
        list: vi.fn(async () => ({
          entries: [{ agent: snapshot }],
          pageInfo: { nextCursor: null },
        })),
        ref: vi.fn(() => ({
          refresh: vi.fn(async () => ({ agent: snapshot, project: null })),
        })),
      },
    } as unknown as PluginHookContext["paseo"];
    return { paseo, signal: new AbortController().signal };
  }

  function store(topic: string): NtfySettingsStore {
    return {
      read: vi.fn(async () => ({
        revision: 1,
        serverId: "server",
        values: { serverUrl: "https://ntfy.example", topic, accessToken: "", priority: 4 },
      })),
    } as unknown as NtfySettingsStore;
  }

  it("rechecks the fresh label before publishing", async () => {
    const publish = vi.fn(async () => {}) as unknown as (
      settings: NtfySettingsValues,
      notification: NtfyNotification,
      options?: { fetch?: NtfyFetch; signal?: AbortSignal; timeoutMs?: number },
    ) => Promise<void>;

    const disabled = new NtfyNotificationService(store("topic"), undefined, publish);
    await disabled.notify(agent, "completed", contextWithLabels({ ntfy: "false" }));
    expect(publish).not.toHaveBeenCalled();

    const enabled = new NtfyNotificationService(store("topic"), undefined, publish);
    await enabled.notify(agent, "completed", contextWithLabels({ ntfy: "true" }));
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ topic: "topic" }),
      expect.objectContaining({
        actions: [
          {
            action: "view",
            label: "Open session",
            url: `paseo://h/server/agent/${agent.id}`,
            clear: true,
          },
        ],
      }),
      expect.objectContaining({ timeoutMs: 10_000 }),
    );
  });

  it("does nothing while the global topic is empty", async () => {
    const publish = vi.fn(async () => {});
    const context = contextWithLabels({ ntfy: "true" });
    const service = new NtfyNotificationService(
      store(""),
      undefined,
      publish as never,
    );
    await service.notify(agent, "permission", context);
    expect(publish).not.toHaveBeenCalled();
    expect(context.paseo.agents.list).not.toHaveBeenCalled();
  });
});
