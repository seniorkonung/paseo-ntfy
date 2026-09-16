import type { PluginButtonIconProps, PluginClientContext } from "@getpaseo/plugin/client";
import { useAgent } from "@getpaseo/plugin/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NtfyPillIcon, registerNtfyPills } from "./pill";

vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: vi.fn(),
}));

vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: () => null,
}));

const mockedUseAgent = vi.mocked(useAgent);

function deferredClient(labels: Readonly<Record<string, string>> = {}) {
  const removePill = vi.fn();
  const removeSubscription = vi.fn();
  const rpc = vi.fn().mockResolvedValue({ enabled: true });
  const refresh = vi.fn().mockResolvedValue({
    agent: { id: "agent-1", workspaceId: "workspace-1", labels },
  });
  let resolveList!: (value: {
    entries: Array<{ agent: { id: string; workspaceId: string; archivedAt: null } }>;
    pageInfo: { nextCursor: null };
  }) => void;
  const list = vi.fn().mockReturnValue(
    new Promise((resolve) => {
      resolveList = resolve;
    }),
  );
  const addComposerPill = vi.fn().mockReturnValue({ update: vi.fn(), remove: removePill });
  const subscribe = vi.fn().mockReturnValue(removeSubscription);

  const client = {
    addComposerPill,
    rpc,
    paseo: {
      agents: {
        list,
        subscribe,
        ref: vi.fn().mockReturnValue({ refresh }),
      },
    },
  } as unknown as PluginClientContext;

  return {
    addComposerPill,
    client,
    refresh,
    removePill,
    removeSubscription,
    resolveList,
    rpc,
  };
}

describe("registerNtfyPills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers the stable Paseo 0.8 button contract and toggles the agent label", async () => {
    const fixture = deferredClient();
    const cleanup = registerNtfyPills(fixture.client);

    fixture.resolveList({
      entries: [{ agent: { id: "agent-1", workspaceId: "workspace-1", archivedAt: null } }],
      pageInfo: { nextCursor: null },
    });
    await vi.waitFor(() => expect(fixture.addComposerPill).toHaveBeenCalledOnce());

    const contribution = fixture.addComposerPill.mock.calls[0]?.[0];
    expect(contribution).toMatchObject({
      id: "ntfy",
      workspaceId: "workspace-1",
      agentId: "agent-1",
      button: {
        title: "Toggle ntfy notifications for this agent",
        label: "Ntfy",
        icon: NtfyPillIcon,
        behavior: { kind: "action" },
      },
    });
    expect(contribution).not.toHaveProperty("title");

    const behavior = contribution?.button.behavior;
    expect(behavior?.kind).toBe("action");
    if (behavior?.kind !== "action") throw new Error("Expected an action button");
    await behavior.onPress();

    expect(fixture.refresh).toHaveBeenCalledOnce();
    expect(fixture.rpc).toHaveBeenCalledWith(expect.anything(), {
      agentId: "agent-1",
      enabled: true,
    });

    cleanup();
    expect(fixture.removeSubscription).toHaveBeenCalledOnce();
    expect(fixture.removePill).toHaveBeenCalledOnce();
  });
});

describe("NtfyPillIcon", () => {
  it("uses the ringing bell and accent color when notifications are enabled", () => {
    mockedUseAgent.mockReturnValue(true);
    const props = {
      context: "agent",
      agentId: "agent-1",
      workspaceId: "workspace-1",
      size: 18,
      color: "muted",
      theme: { colors: { accent: "accent" } },
      host: { id: "host-1", label: "Host" },
      layout: { compact: false, platform: "web" },
    } as PluginButtonIconProps;

    const icon = NtfyPillIcon(props);

    expect(mockedUseAgent).toHaveBeenCalledWith("agent-1", expect.any(Function));
    expect(icon.props).toMatchObject({ name: "BellRing", size: 18, color: "accent" });
  });
});
