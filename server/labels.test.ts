import { describe, expect, it, vi } from "vitest";
import { setAgentNtfyLabel, type LabelCommandRunner } from "./labels";

describe("setAgentNtfyLabel", () => {
  it("uses argv without a shell and writes true or false", async () => {
    const run = vi.fn<LabelCommandRunner>().mockResolvedValue({});
    await setAgentNtfyLabel("agent_123", true, run);
    await setAgentNtfyLabel("agent_123", false, run);

    expect(run).toHaveBeenNthCalledWith(
      1,
      "paseo",
      ["agent", "update", "agent_123", "--label", "ntfy=true", "--json"],
      { timeout: 10_000, maxBuffer: 1024 * 1024 },
    );
    expect(run).toHaveBeenNthCalledWith(
      2,
      "paseo",
      ["agent", "update", "agent_123", "--label", "ntfy=false", "--json"],
      { timeout: 10_000, maxBuffer: 1024 * 1024 },
    );
  });

  it("rejects option and shell-like agent IDs", async () => {
    const run = vi.fn<LabelCommandRunner>().mockResolvedValue({});
    await expect(setAgentNtfyLabel("--host", true, run)).rejects.toThrow();
    await expect(setAgentNtfyLabel("agent;echo", true, run)).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
});
