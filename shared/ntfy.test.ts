import { describe, expect, it } from "vitest";
import {
  isNtfyEnabled,
  ntfyLabelValue,
  ntfySettingsValuesSchema,
} from "./ntfy";

describe("ntfy label semantics", () => {
  it("enables notifications only for the exact true value", () => {
    expect(isNtfyEnabled(undefined)).toBe(false);
    expect(isNtfyEnabled({})).toBe(false);
    expect(isNtfyEnabled({ ntfy: "false" })).toBe(false);
    expect(isNtfyEnabled({ ntfy: "TRUE" })).toBe(false);
    expect(isNtfyEnabled({ ntfy: "yes" })).toBe(false);
    expect(isNtfyEnabled({ ntfy: "true" })).toBe(true);
  });

  it("renders the two mergeable label assignments", () => {
    expect(ntfyLabelValue(true)).toBe("ntfy=true");
    expect(ntfyLabelValue(false)).toBe("ntfy=false");
  });
});

describe("ntfy settings", () => {
  it("accepts only the five ntfy priorities", () => {
    const base = { serverUrl: "https://ntfy.sh", topic: "topic", accessToken: "" };
    for (const priority of [1, 2, 3, 4, 5]) {
      expect(ntfySettingsValuesSchema.safeParse({ ...base, priority }).success).toBe(true);
    }
    expect(ntfySettingsValuesSchema.safeParse({ ...base, priority: 0 }).success).toBe(false);
    expect(ntfySettingsValuesSchema.safeParse({ ...base, priority: 6 }).success).toBe(false);
  });
});
