import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonProviderSubagentSource, daemonTarget } from "./provider-subagents";

describe("daemonTarget", () => {
  it("maps the daemon listen address to a WebSocket target", () => {
    expect(daemonTarget("192.168.0.104:6767")).toEqual({ url: "ws://192.168.0.104:6767/ws" });
    expect(daemonTarget("tcp://localhost:6767")).toEqual({ url: "ws://localhost:6767/ws" });
    expect(daemonTarget("[::1]:6767")).toEqual({ url: "ws://[::1]:6767/ws" });
    expect(daemonTarget("/run/paseo.sock")).toEqual({
      url: "ws+unix:///run/paseo.sock:/ws",
      socketPath: "/run/paseo.sock",
    });
    expect(daemonTarget("unix:///run/paseo.sock").socketPath).toBe("/run/paseo.sock");
    expect(() => daemonTarget("tcp://example.com:6767?ssl=true")).toThrow("Unsupported");
  });
});

describe("DaemonProviderSubagentSource", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "paseo-ntfy-"));
    writeFileSync(path.join(home, "paseo.pid"), JSON.stringify({ listen: "127.0.0.1:6767" }));
    writeFileSync(path.join(home, "local-credential"), "local-token\n");
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  function fakeHost(responses: Array<() => Promise<unknown>>) {
    const clients: Array<{ config: Record<string, unknown>; close: ReturnType<typeof vi.fn> }> = [];
    class DaemonClient {
      readonly close = vi.fn(async () => {});
      constructor(readonly config: Record<string, unknown>) {
        clients.push(this);
      }
      async connect() {}
      listProviderSubagents = vi.fn(async () => {
        const next = responses.shift();
        if (!next) throw new Error("unexpected request");
        return next();
      });
    }
    class WebSocket {}
    const load = vi.fn((name: string) => {
      if (name === "@getpaseo/client/internal/daemon-client") return { DaemonClient };
      if (name === "ws") return { WebSocket };
      throw new Error(`unexpected module ${name}`);
    });
    return { clients, load };
  }

  it("connects like the CLI and reuses the session", async () => {
    const subagents = [{ id: "toolu_agent", toolCallId: "toolu_agent", status: "running" }];
    const host = fakeHost([
      async () => ({ subagents, error: null }),
      async () => ({ subagents: [], error: null }),
    ]);
    const source = new DaemonProviderSubagentSource(host.load, home);

    expect(await source.list("agent-1")).toEqual(subagents);
    expect(await source.list("agent-1")).toEqual([]);
    expect(host.clients).toHaveLength(1);
    const config = host.clients[0]!.config;
    expect(config).toMatchObject({
      url: "ws://127.0.0.1:6767/ws",
      clientId: "paseo-ntfy",
      clientType: "cli",
      reconnect: { enabled: false },
    });
    expect((config.localCredential as () => string)()).toBe("local-token");

    source.close();
    await vi.waitFor(() => expect(host.clients[0]!.close).toHaveBeenCalled());
  });

  it("retries once on a fresh session", async () => {
    const host = fakeHost([
      async () => {
        throw new Error("socket closed");
      },
      async () => ({ subagents: [], error: null }),
    ]);
    const source = new DaemonProviderSubagentSource(host.load, home);

    expect(await source.list("agent-1")).toEqual([]);
    expect(host.clients).toHaveLength(2);
  });

  it("reports daemon errors", async () => {
    const host = fakeHost([
      async () => ({ subagents: [], error: "agent not found" }),
      async () => ({ subagents: [], error: "agent not found" }),
    ]);
    await expect(new DaemonProviderSubagentSource(host.load, home).list("agent-1")).rejects.toThrow(
      "agent not found",
    );
  });

  it("fails when the daemon is not running", async () => {
    rmSync(path.join(home, "paseo.pid"));
    const host = fakeHost([]);
    await expect(new DaemonProviderSubagentSource(host.load, home).list("agent-1")).rejects.toThrow();
  });
});
