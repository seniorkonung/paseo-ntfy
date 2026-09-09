import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { ntfyLabelValue } from "../shared/ntfy";

const execFile = promisify(execFileCallback);

export type LabelCommandRunner = (
  executable: string,
  args: readonly string[],
  options: { timeout: number; maxBuffer: number },
) => Promise<unknown>;

export async function setAgentNtfyLabel(
  agentId: string,
  enabled: boolean,
  run: LabelCommandRunner = execFile as LabelCommandRunner,
): Promise<void> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(agentId)) {
    throw new Error("Agent ID contains unsupported characters.");
  }
  try {
    await run(
      "paseo",
      ["agent", "update", agentId, "--label", ntfyLabelValue(enabled), "--json"],
      { timeout: 10_000, maxBuffer: 1024 * 1024 },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("The Paseo CLI is not available in the plugin process PATH.");
    }
    throw error;
  }
}
