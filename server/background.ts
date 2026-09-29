import type { PluginLifecycleEvents } from "@getpaseo/plugin/server";

export type TimelineItem = PluginLifecycleEvents["agent.turn_ended"]["timeline"][number];
type ToolCallItem = Extract<TimelineItem, { type: "tool_call" }>;

export interface ProviderSubagentStatus {
  id: string;
  toolCallId: string | null;
  status: string;
}

// Claude Code answers a backgrounded Bash or Monitor call with one of these and later wakes the
// agent with a task notification. Anchored so tool output that merely quotes them is ignored.
const BACKGROUND_LAUNCH_PATTERNS = [
  /^Command running in background with ID: ([A-Za-z0-9_-]+)/,
  /^Command did not complete within its \d+s timeout and was moved to the background \(ID: ([A-Za-z0-9_-]+)\)/,
  /^Monitor started \(task ([A-Za-z0-9_-]+)/,
];
const TASK_STOP_TOOLS = new Set(["TaskStop", "KillShell", "KillBash"]);

/** Items after the user's latest message: the work the agent is doing for that message. */
export function currentRequestItems(timeline: readonly TimelineItem[]): readonly TimelineItem[] {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    if (timeline[index]?.type === "user_message") return timeline.slice(index + 1);
  }
  return timeline;
}

/** Background Bash and Monitor tasks that were started but have neither finished nor been stopped. */
export function pendingBackgroundTaskIds(items: readonly TimelineItem[]): string[] {
  const pending = new Set<string>();
  for (const item of items) {
    if (item.type !== "tool_call") continue;
    const finishedTaskId = finishedTaskNotificationId(item);
    if (finishedTaskId) {
      pending.delete(finishedTaskId);
      continue;
    }
    const stoppedId = stoppedTaskId(item);
    if (stoppedId) {
      pending.delete(stoppedId);
      continue;
    }
    const launchedTaskId = backgroundLaunchId(item);
    if (launchedTaskId) pending.add(launchedTaskId);
  }
  return [...pending];
}

/** Tool call ids of provider subagents (Task/Agent, workflows) started for the current request. */
export function subagentCallIds(items: readonly TimelineItem[]): string[] {
  const callIds = new Set<string>();
  for (const item of items) {
    if (item.type === "tool_call" && item.detail.type === "sub_agent") callIds.add(item.callId);
  }
  return [...callIds];
}

export function hasRunningSubagent(
  callIds: readonly string[],
  subagents: readonly ProviderSubagentStatus[],
): boolean {
  const wanted = new Set(callIds);
  return subagents.some(
    (subagent) =>
      subagent.status === "running" && wanted.has(subagent.toolCallId ?? subagent.id),
  );
}

/** Whether the items after a notification contain nothing but the agent talking to itself. */
export function hasOnlyAgentMessages(items: readonly TimelineItem[]): boolean {
  return items.every((item) => item.type === "assistant_message" || item.type === "reasoning");
}

function finishedTaskNotificationId(item: ToolCallItem): string | null {
  if (item.name !== "task_notification") return null;
  const metadata = item.metadata ?? {};
  if (metadata.source !== "claude_task_notification") return null;
  // Monitor events arrive as "running" notifications; the watch is still active.
  if (metadata.status === "running") return null;
  return typeof metadata.taskId === "string" ? metadata.taskId : null;
}

function stoppedTaskId(item: ToolCallItem): string | null {
  if (!TASK_STOP_TOOLS.has(item.name) || item.status !== "completed") return null;
  if (item.detail.type !== "unknown") return null;
  const input = item.detail.input;
  if (input === null || typeof input !== "object") return null;
  const { task_id: taskId, shell_id: shellId } = input as Record<string, unknown>;
  if (typeof taskId === "string") return taskId;
  return typeof shellId === "string" ? shellId : null;
}

function backgroundLaunchId(item: ToolCallItem): string | null {
  for (const text of toolOutputTexts(item)) {
    for (const pattern of BACKGROUND_LAUNCH_PATTERNS) {
      const match = pattern.exec(text.trimStart());
      if (match?.[1]) return match[1];
    }
  }
  return null;
}

function toolOutputTexts(item: ToolCallItem): string[] {
  const { detail } = item;
  if (detail.type === "shell") return detail.output ? [detail.output] : [];
  if (detail.type === "plain_text") return detail.text ? [detail.text] : [];
  if (detail.type === "unknown") return collectTexts(detail.output);
  return [];
}

function collectTexts(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectTexts);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [...collectTexts(record.text), ...collectTexts(record.output), ...collectTexts(record.content)];
  }
  return [];
}
