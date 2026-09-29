import type { PluginHookAgent } from "@getpaseo/plugin/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderSubagentStatus, TimelineItem } from "./background";
import { CompletedTurnFilter } from "./completed-turns";
import type { ProviderSubagentSource } from "./provider-subagents";

const agent: PluginHookAgent = {
  id: "7cfbcce2-3cb1-4016-9b44-ba88d5af5778",
  workspaceId: null,
  parentAgentId: null,
  provider: "claude",
  cwd: "/work",
  title: "Background test",
};

const user = (text: string): TimelineItem => ({ type: "user_message", text });
const assistant = (text: string): TimelineItem => ({ type: "assistant_message", text });

function subagentCall(log: string): TimelineItem {
  return {
    type: "tool_call",
    callId: "toolu_agent",
    name: "Task",
    detail: { type: "sub_agent", log, actions: [] },
    status: "running",
    error: null,
  };
}

function source(...statuses: string[]): ProviderSubagentSource & { list: ReturnType<typeof vi.fn> } {
  const list = vi.fn(async (): Promise<ProviderSubagentStatus[]> => [
    { id: "toolu_agent", toolCallId: "toolu_agent", status: statuses.shift() ?? "completed" },
  ]);
  return { list, close: vi.fn() };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CompletedTurnFilter with a background subagent", () => {
  // The turns Claude produced in session 7cfbcce2 when asked to start a background agent.
  const launchTurn = [
    user("Start a background agent that waits 10 seconds and returns hello world."),
    subagentCall("[Bash] sleep 10"),
    assistant("Started the background agent, I will report when it finishes."),
  ];
  const handBackTurn = [
    ...launchTurn,
    subagentCall("[SubagentHandback]"),
    assistant("The background agent returned hello world."),
  ];
  const notificationTurn = [
    ...handBackTurn,
    assistant("That is a repeat notification for the same agent; nothing else to do."),
  ];

  it("notifies once, when the subagent has handed back its result", async () => {
    const filter = new CompletedTurnFilter(source("running", "completed", "completed"));
    expect(await filter.shouldNotify(agent, launchTurn)).toBe(false);
    expect(await filter.shouldNotify(agent, handBackTurn)).toBe(true);
    expect(await filter.shouldNotify(agent, notificationTurn)).toBe(false);
  });

  it("notifies after the task notification when the status lags behind the hand-back", async () => {
    const filter = new CompletedTurnFilter(source("running", "running", "completed"));
    expect(await filter.shouldNotify(agent, launchTurn)).toBe(false);
    expect(await filter.shouldNotify(agent, handBackTurn)).toBe(false);
    expect(await filter.shouldNotify(agent, notificationTurn)).toBe(true);
  });

  it("notifies when the subagent status cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: ProviderSubagentSource = {
      list: vi.fn(async () => {
        throw new Error("daemon unavailable");
      }),
      close: vi.fn(),
    };
    expect(await new CompletedTurnFilter(failing).shouldNotify(agent, launchTurn)).toBe(true);
    expect(console.error).toHaveBeenCalledOnce();
  });

  it("does not wait for subagents started before the latest user message", async () => {
    const subagents = source("running");
    const answer = [...launchTurn, user("How is it going?"), assistant("Still running.")];
    expect(await new CompletedTurnFilter(subagents).shouldNotify(agent, answer)).toBe(true);
    expect(subagents.list).not.toHaveBeenCalled();
  });
});

describe("CompletedTurnFilter with background commands", () => {
  const launchTurn: TimelineItem[] = [
    user("Run a 10 second process in the background."),
    {
      type: "tool_call",
      callId: "toolu_bash",
      name: "Bash",
      detail: {
        type: "shell",
        command: "sleep 10",
        output:
          "Command running in background with ID: bohlrzt8j. Output is being written to: /tmp/tasks/bohlrzt8j.output. You will be notified when it completes.",
      },
      status: "completed",
      error: null,
    },
    assistant("Started it in the background."),
  ];
  const resultTurn: TimelineItem[] = [
    ...launchTurn,
    {
      type: "tool_call",
      callId: "task_notification_1",
      name: "task_notification",
      detail: { type: "plain_text", label: "Background command completed (exit code 0)" },
      metadata: {
        synthetic: true,
        source: "claude_task_notification",
        taskId: "bohlrzt8j",
        toolUseId: "toolu_bash",
        status: "completed",
      },
      status: "completed",
      error: null,
    },
    assistant("The background process finished successfully."),
  ];

  it("skips the launch turn and notifies when the result arrives", async () => {
    const subagents = source();
    const filter = new CompletedTurnFilter(subagents);
    expect(await filter.shouldNotify(agent, launchTurn)).toBe(false);
    expect(await filter.shouldNotify(agent, resultTurn)).toBe(true);
    expect(subagents.list).not.toHaveBeenCalled();
  });
});

describe("CompletedTurnFilter repeat detection", () => {
  const done = [user("Fix the bug."), assistant("Fixed.")];

  it("notifies again after the user replies", async () => {
    const filter = new CompletedTurnFilter(source());
    expect(await filter.shouldNotify(agent, done)).toBe(true);
    expect(await filter.shouldNotify(agent, [...done, user("Thanks!"), assistant("You're welcome.")])).toBe(true);
  });

  it("notifies again when the agent did more work on its own", async () => {
    const filter = new CompletedTurnFilter(source());
    const work: TimelineItem = {
      type: "tool_call",
      callId: "toolu_read",
      name: "Read",
      detail: { type: "read", filePath: "/work/a.ts" },
      status: "completed",
      error: null,
    };
    expect(await filter.shouldNotify(agent, done)).toBe(true);
    expect(await filter.shouldNotify(agent, [...done, work, assistant("Checked again.")])).toBe(true);
  });

  it("notifies when the timeline no longer matches the remembered position", async () => {
    const filter = new CompletedTurnFilter(source());
    expect(await filter.shouldNotify(agent, done)).toBe(true);
    expect(await filter.shouldNotify(agent, [user("Other."), assistant("Rewritten."), assistant("More.")])).toBe(true);
  });

  it("forgets the position after another kind of notification", async () => {
    const filter = new CompletedTurnFilter(source());
    expect(await filter.shouldNotify(agent, done)).toBe(true);
    filter.forget(agent.id);
    expect(await filter.shouldNotify(agent, [...done, assistant("Retrying.")])).toBe(true);
  });
});

it("leaves other providers unchanged", async () => {
  const subagents = source("running");
  const codex = { ...agent, provider: "codex" };
  const filter = new CompletedTurnFilter(subagents);
  const timeline = [user("Go."), subagentCall("working")];
  expect(await filter.shouldNotify(codex, timeline)).toBe(true);
  expect(await filter.shouldNotify(codex, [...timeline, assistant("Again.")])).toBe(true);
  expect(subagents.list).not.toHaveBeenCalled();
});
