import { describe, expect, it } from "vitest";
import {
  isNtfyEnabled,
  ntfyLabelValue,
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
