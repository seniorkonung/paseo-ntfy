import { describe, expect, it, vi } from "vitest";
import { paseoAgentDeepLink, publishNtfy, type NtfyFetch } from "./publisher";

const settings = {
  serverUrl: "https://ntfy.example",
  topic: "paseo_agents",
  accessToken: "tk_secret",
};

describe("publishNtfy", () => {
  it("sends the exact JSON payload and Bearer header", async () => {
    const fetchNtfy = vi.fn<NtfyFetch>().mockResolvedValue({
      ok: true,
      status: 200,
    });
    await publishNtfy(
      settings,
      {
        title: "Paseo · Agent",
        message: "Agent finished and is waiting for you.",
        click: "paseo://h/server/agent/agent-id",
      },
      { fetch: fetchNtfy },
    );

    expect(fetchNtfy).toHaveBeenCalledOnce();
    const [url, init] = fetchNtfy.mock.calls[0]!;
    expect(url).toBe("https://ntfy.example");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer tk_secret",
    });
    expect(JSON.parse(init.body)).toEqual({
      topic: "paseo_agents",
      title: "Paseo · Agent",
      message: "Agent finished and is waiting for you.",
      priority: 3,
      click: "paseo://h/server/agent/agent-id",
    });
  });

  it("omits optional auth and click", async () => {
    const fetchNtfy = vi.fn<NtfyFetch>().mockResolvedValue({
      ok: true,
      status: 200,
    });
    await publishNtfy(
      { ...settings, accessToken: "" },
      { title: "Test", message: "Test" },
      { fetch: fetchNtfy },
    );
    const [, init] = fetchNtfy.mock.calls[0]!;
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).not.toHaveProperty("click");
  });

  it("fails once on non-success and enforces the timeout", async () => {
    const rejected = vi.fn<NtfyFetch>().mockResolvedValue({
      ok: false,
      status: 403,
    });
    await expect(
      publishNtfy(settings, { title: "Test", message: "Test" }, { fetch: rejected }),
    ).rejects.toThrow("HTTP 403");
    expect(rejected).toHaveBeenCalledOnce();

    const hanging: NtfyFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    await expect(
      publishNtfy(settings, { title: "Test", message: "Test" }, { fetch: hanging, timeoutMs: 5 }),
    ).rejects.toThrow("aborted");
  });
});

describe("paseoAgentDeepLink", () => {
  it("encodes both path segments", () => {
    expect(paseoAgentDeepLink("host/id", "agent id")).toBe(
      "paseo://h/host%2Fid/agent/agent%20id",
    );
  });
});
