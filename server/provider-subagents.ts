import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ProviderSubagentStatus } from "./background";

export interface ProviderSubagentSource {
  list(agentId: string): Promise<ProviderSubagentStatus[]>;
  close(): void;
}

// The plugin SDK does not expose provider subagents yet, so this opens a second daemon session the
// way the Paseo CLI does. DaemonClient and ws come from the Paseo host installation: the plugin
// runtime resolves unknown modules from there, and the plugin ships no runtime dependencies.
interface DaemonClientLike {
  connect(): Promise<void>;
  close(): Promise<void>;
  listProviderSubagents(parentAgentId: string): Promise<{
    subagents: ProviderSubagentStatus[];
    error: string | null;
  }>;
}

interface WebSocketFactoryConfig {
  headers?: Record<string, string>;
  protocols?: string[];
}

export type HostModuleLoader = (name: string) => unknown;

const REQUEST_TIMEOUT_MS = 5_000;
const CLIENT_ID = "paseo-ntfy";

export class DaemonProviderSubagentSource implements ProviderSubagentSource {
  private client: Promise<DaemonClientLike> | null = null;

  constructor(
    private readonly load: HostModuleLoader = loadHostModule,
    private readonly paseoHome = process.env.PASEO_HOME || path.join(homedir(), ".paseo"),
  ) {}

  async list(agentId: string): Promise<ProviderSubagentStatus[]> {
    try {
      return await this.request(agentId);
    } catch {
      // The daemon may have restarted since the session opened; retry once on a fresh one.
      this.close();
      return this.request(agentId);
    }
  }

  close(): void {
    const client = this.client;
    this.client = null;
    void client?.then((connected) => connected.close()).catch(() => {});
  }

  private async request(agentId: string): Promise<ProviderSubagentStatus[]> {
    const client = await this.connect();
    const response = await withTimeout(client.listProviderSubagents(agentId), "list subagents");
    if (response.error) throw new Error(response.error);
    return response.subagents;
  }

  private connect(): Promise<DaemonClientLike> {
    if (!this.client) {
      const connecting = this.open();
      this.client = connecting;
      connecting.catch(() => {
        if (this.client === connecting) this.client = null;
      });
    }
    return this.client;
  }

  private async open(): Promise<DaemonClientLike> {
    const { DaemonClient } = this.load("@getpaseo/client/internal/daemon-client") as {
      DaemonClient: new (config: Record<string, unknown>) => DaemonClientLike;
    };
    const { WebSocket } = this.load("ws") as {
      WebSocket: new (url: string, protocols: unknown, options: Record<string, unknown>) => unknown;
    };
    const target = daemonTarget(readListenAddress(this.paseoHome));
    const password = process.env.PASEO_PASSWORD;
    const client = new DaemonClient({
      url: target.url,
      clientId: CLIENT_ID,
      clientType: "cli",
      ...(password ? { password } : {}),
      localCredential: () => readLocalCredential(this.paseoHome),
      connectTimeoutMs: REQUEST_TIMEOUT_MS,
      reconnect: { enabled: false },
      webSocketFactory: (url: string, config?: WebSocketFactoryConfig) =>
        new WebSocket(url, config?.protocols, {
          headers: config?.headers,
          ...(target.socketPath ? { socketPath: target.socketPath } : {}),
        }),
    });
    try {
      await withTimeout(client.connect(), "connect to the Paseo daemon");
      return client;
    } catch (error) {
      await client.close().catch(() => {});
      throw error;
    }
  }
}

export function daemonTarget(listen: string): { url: string; socketPath?: string } {
  const trimmed = listen.trim();
  const socketPath = trimmed.startsWith("unix://")
    ? trimmed.slice("unix://".length)
    : trimmed.startsWith("/")
      ? trimmed
      : null;
  if (socketPath) return { url: `ws+unix://${socketPath}:/ws`, socketPath };
  const endpoint = trimmed.replace(/^tcp:\/\//, "");
  if (!/^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+):\d+$/.test(endpoint)) {
    throw new Error(`Unsupported Paseo daemon address: ${listen}`);
  }
  return { url: `ws://${endpoint}/ws` };
}

function readListenAddress(paseoHome: string): string {
  const lock = JSON.parse(readFileSync(path.join(paseoHome, "paseo.pid"), "utf8")) as {
    listen?: unknown;
  };
  if (typeof lock.listen !== "string") throw new Error("The Paseo daemon address is unknown.");
  return lock.listen;
}

function readLocalCredential(paseoHome: string): string | undefined {
  try {
    const token = readFileSync(path.join(paseoHome, "local-credential"), "utf8").trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

function loadHostModule(name: string): unknown {
  // A non-literal specifier keeps esbuild from bundling the module; the Paseo plugin runtime
  // passes its own require into the bundle, which resolves from the host installation.
  return require(name);
}

function withTimeout<T>(promise: Promise<T>, action: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out trying to ${action}.`)), REQUEST_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
