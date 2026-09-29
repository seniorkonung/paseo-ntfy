import { describe, expect, it } from "vitest";
import {
  currentRequestItems,
  hasOnlyAgentMessages,
  hasRunningSubagent,
  pendingBackgroundTaskIds,
  subagentCallIds,
  type TimelineItem,
} from "./background";

const user = (text: string): TimelineItem => ({ type: "user_message", text });
const assistant = (text: string): TimelineItem => ({ type: "assistant_message", text });

function shell(callId: string, output: string): TimelineItem {
  return {
    type: "tool_call",
    callId,
    name: "Bash",
    detail: { type: "shell", command: "sleep 10", output },
    status: "completed",
    error: null,
  };
}

function taskNotification(taskId: string, toolUseId: string, status = "completed"): TimelineItem {
  return {
    type: "tool_call",
    callId: `task_notification_${taskId}_${status}`,
    name: "task_notification",
    detail: { type: "plain_text", label: `Background task ${status}`, icon: "wrench" },
    metadata: { synthetic: true, source: "claude_task_notification", taskId, toolUseId, status },
    status: "completed",
    error: null,
  };
}

function unknownTool(callId: string, name: string, input: unknown, output: unknown): TimelineItem {
  return {
    type: "tool_call",
    callId,
    name,
    detail: { type: "unknown", input, output },
    status: "completed",
    error: null,
  };
}

function subagent(callId: string, log: string): TimelineItem {
  return {
    type: "tool_call",
    callId,
    name: "Task",
    detail: { type: "sub_agent", log, actions: [] },
    status: "running",
    error: null,
  };
}

const backgroundBash = shell(
  "toolu_bash",
  "Command running in background with ID: bohlrzt8j. Output is being written to: /tmp/claude-1000/project/session/tasks/bohlrzt8j.output. You will be notified when it completes. To check interim output, use Read on that file path.",
);

describe("currentRequestItems", () => {
  it("keeps only the work after the latest user message", () => {
    const answer = assistant("second answer");
    expect(
      currentRequestItems([user("first"), assistant("first answer"), user("second"), answer]),
    ).toEqual([answer]);
  });

  it("uses the whole timeline when there is no user message", () => {
    const timeline = [assistant("hello")];
    expect(currentRequestItems(timeline)).toEqual(timeline);
  });
});

describe("pendingBackgroundTaskIds", () => {
  it("tracks a background Bash command until its task notification", () => {
    const started = [backgroundBash, assistant("Started, I will report back.")];
    expect(pendingBackgroundTaskIds(started)).toEqual(["bohlrzt8j"]);
    expect(
      pendingBackgroundTaskIds([...started, taskNotification("bohlrzt8j", "toolu_bash")]),
    ).toEqual([]);
  });

  it("treats failed and killed tasks as finished", () => {
    expect(
      pendingBackgroundTaskIds([backgroundBash, taskNotification("bohlrzt8j", "toolu_bash", "failed")]),
    ).toEqual([]);
    expect(
      pendingBackgroundTaskIds([backgroundBash, taskNotification("bohlrzt8j", "toolu_bash", "killed")]),
    ).toEqual([]);
  });

  it("recognizes commands moved to the background by their timeout", () => {
    const moved = shell(
      "toolu_slow",
      "Command did not complete within its 600s timeout and was moved to the background (ID: bbeo54vqm). Output is being written to: /tmp/tasks/bbeo54vqm.output.",
    );
    expect(pendingBackgroundTaskIds([moved])).toEqual(["bbeo54vqm"]);
  });

  it("keeps a Monitor watch pending through its events", () => {
    const monitor = unknownTool(
      "toolu_monitor",
      "Monitor",
      { command: "until test -f done; do sleep 5; done" },
      "Monitor started (task bcajkziyg, expires in 30m unless the source ends first). You will be notified on each event.",
    );
    const event = taskNotification("bcajkziyg", "toolu_monitor", "running");
    expect(pendingBackgroundTaskIds([monitor, event])).toEqual(["bcajkziyg"]);
    expect(
      pendingBackgroundTaskIds([monitor, event, taskNotification("bcajkziyg", "toolu_monitor")]),
    ).toEqual([]);
  });

  it("reads launch text from content blocks of unknown tools", () => {
    const monitor = unknownTool("toolu_monitor", "Monitor", {}, [
      { type: "text", text: "Monitor started (task b5prph90c, expires in 15m)." },
    ]);
    expect(pendingBackgroundTaskIds([monitor])).toEqual(["b5prph90c"]);
  });

  it("forgets tasks stopped by the agent, which Claude does not notify about", () => {
    expect(
      pendingBackgroundTaskIds([
        backgroundBash,
        unknownTool("toolu_stop", "TaskStop", { task_id: "bohlrzt8j" }, null),
      ]),
    ).toEqual([]);
    expect(
      pendingBackgroundTaskIds([
        backgroundBash,
        unknownTool("toolu_kill", "KillShell", { shell_id: "bohlrzt8j" }, null),
      ]),
    ).toEqual([]);
  });

  it("ignores output that only quotes the launch message", () => {
    const quoted = shell(
      "toolu_grep",
      'transcript.jsonl: "Command running in background with ID: bohlrzt8j."',
    );
    expect(pendingBackgroundTaskIds([quoted])).toEqual([]);
  });
});

describe("subagents", () => {
  const launched = subagent("toolu_agent", "[Bash] sleep 10");
  const handedBack = subagent("toolu_agent", "[SubagentHandback]");

  it("collects each subagent tool call once", () => {
    expect(subagentCallIds([launched, assistant("Started."), handedBack])).toEqual([
      "toolu_agent",
    ]);
  });

  it("waits only for running subagents started by the current request", () => {
    const running = { id: "toolu_agent", toolCallId: "toolu_agent", status: "running" };
    expect(hasRunningSubagent(["toolu_agent"], [running])).toBe(true);
    expect(hasRunningSubagent(["toolu_agent"], [{ ...running, status: "completed" }])).toBe(false);
    expect(hasRunningSubagent(["toolu_other"], [running])).toBe(false);
    expect(hasRunningSubagent(["toolu_agent"], [{ ...running, toolCallId: null }])).toBe(true);
  });
});

describe("hasOnlyAgentMessages", () => {
  it("is true only for assistant text and reasoning", () => {
    expect(hasOnlyAgentMessages([assistant("again"), { type: "reasoning", text: "hm" }])).toBe(true);
    expect(hasOnlyAgentMessages([assistant("again"), backgroundBash])).toBe(false);
    expect(hasOnlyAgentMessages([user("hi")])).toBe(false);
  });
});
