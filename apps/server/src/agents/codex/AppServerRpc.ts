import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { createInterface } from "node:readline";

export interface RpcMessage {
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string };
}
export interface RpcTransport {
  request<T = any>(
    method: string,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<T>;
  notify(method: string, params?: unknown): void;
  onNotification(listener: (message: RpcMessage) => void): () => void;
  onRequest(handler: (message: RpcMessage) => Promise<unknown>): void;
  isAlive(): boolean;
  close(): Promise<void>;
}
/** Newline-delimited JSON-RPC over private stdio. No network listener or shell interpolation. */
export class AppServerRpc implements RpcTransport {
  private readonly child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      cleanup: () => void;
    }
  >();
  private readonly listeners = new Set<(message: RpcMessage) => void>();
  private handler: (message: RpcMessage) => Promise<unknown> = async () => {
    throw new Error("REQUEST_NOT_ALLOWED");
  };
  private alive = true;
  constructor(
    command: string,
    args: string[],
    options: SpawnOptionsWithoutStdio = {},
    private readonly timeoutMs = 30000,
  ) {
    this.child = spawn(command, args, {
      ...options,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      if (line.length > 10_000_000) {
        this.fail("PROTOCOL_MESSAGE_TOO_LARGE");
        return;
      }
      try {
        this.receive(JSON.parse(line));
      } catch {
        this.fail("INVALID_APP_SERVER_MESSAGE");
      }
    });
    // Drain stderr without exposing logs, prompts, credentials, or raw reasoning.
    this.child.stderr.on("data", () => {});
    this.child.on("error", () => this.fail("CODEX_PROCESS_UNAVAILABLE"));
    this.child.on("exit", () => {
      lines.close();
      this.fail("CODEX_PROCESS_EXITED");
    });
    this.child.stdin.on("error", () => this.fail("CODEX_PIPE_CLOSED"));
  }
  isAlive() {
    return this.alive;
  }
  notify(method: string, params?: unknown) {
    this.send({ method, params });
  }
  onNotification(listener: (message: RpcMessage) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  onRequest(handler: (message: RpcMessage) => Promise<unknown>) {
    this.handler = handler;
  }
  private send(message: RpcMessage) {
    if (!this.alive) throw new Error("CODEX_DISCONNECTED");
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }
  private receive(message: RpcMessage) {
    if (message.method) {
      if (message.id !== undefined) {
        void this.handler(message).then(
          (result) => {
            if (this.alive) this.send({ id: message.id, result });
          },
          () => {
            if (this.alive)
              this.send({
                id: message.id,
                error: { code: -32601, message: "REQUEST_NOT_ALLOWED" },
              });
          },
        );
      } else for (const listener of this.listeners) listener(message);
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    pending.cleanup();
    if (message.error)
      pending.reject(
        new Error(
          `CODEX_RPC_ERROR:${message.error.code}:${String(message.error.message).slice(0, 400)}`,
        ),
      );
    else pending.resolve(message.result);
  }
  request<T = any>(
    method: string,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!this.alive) return Promise.reject(new Error("CODEX_DISCONNECTED"));
    if (signal?.aborted) return Promise.reject(new Error("DECISION_CANCELLED"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id);
        cleanup();
        reject(new Error("DECISION_CANCELLED"));
      };
      const timer = setTimeout(() => {
        this.pending.delete(id);
        cleanup();
        reject(new Error("CODEX_RPC_TIMEOUT"));
      }, this.timeoutMs);
      timer.unref();
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      };
      this.pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener("abort", abort, { once: true });
      try {
        this.send({ id, method, params });
      } catch {
        this.pending.delete(id);
        cleanup();
        reject(new Error("CODEX_DISCONNECTED"));
      }
    });
  }
  private fail(code: string) {
    if (!this.alive) return;
    this.alive = false;
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(new Error(code));
    }
    this.pending.clear();
    for (const listener of this.listeners)
      listener({ method: "transport/closed", params: { code } });
    this.child.kill("SIGTERM");
  }
  async close() {
    this.fail("CODEX_CLOSED");
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill("SIGKILL");
        resolve();
      }, 2000);
      timer.unref();
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
