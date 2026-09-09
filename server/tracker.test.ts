import { describe, expect, it } from "vitest";
import { AgentNtfyTracker } from "./tracker";

describe("AgentNtfyTracker", () => {
  it("tracks each session independently", () => {
    const tracker = new AgentNtfyTracker();
    for (let index = 0; index < 10; index += 1) {
      tracker.update(`agent-${index}`, { ntfy: index < 6 ? "true" : "false" });
    }

    expect(
      Array.from({ length: 10 }, (_, index) => tracker.isEnabled(`agent-${index}`)).filter(Boolean),
    ).toHaveLength(6);
    expect(tracker.isEnabled("agent-0")).toBe(true);
    expect(tracker.isEnabled("agent-7")).toBe(false);
  });

  it("reacts to value changes, removal, and archive", () => {
    const tracker = new AgentNtfyTracker();
    tracker.update("agent", { ntfy: "true", other: "preserved" });
    expect(tracker.isEnabled("agent")).toBe(true);

    tracker.update("agent", { ntfy: "false", other: "preserved" });
    expect(tracker.isEnabled("agent")).toBe(false);

    tracker.update("agent", { ntfy: "true" }, "2026-09-10T00:00:00.000Z");
    expect(tracker.isEnabled("agent")).toBe(false);

    tracker.update("agent", { ntfy: "true" });
    tracker.remove("agent");
    expect(tracker.isEnabled("agent")).toBe(false);
  });
});
