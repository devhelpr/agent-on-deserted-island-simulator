import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { AppServerRpc, type RpcTransport } from "./AppServerRpc.js";

export interface CodexRuntime {
  rpc: RpcTransport;
  cwd: string;
  restart?(): Promise<RpcTransport>;
  close(): Promise<void>;
}
export type RuntimeFactory = () => Promise<CodexRuntime>;
export const ISLAND_CONFIG = `
model = "gpt-6-luna"
model_reasoning_effort = "high"
cli_auth_credentials_store = "file"
approval_policy = "never"
default_permissions = "island"
web_search = "disabled"
project_doc_max_bytes = 0
mcp_servers = {}
[features]
shell_tool = false
unified_exec = false
shell_snapshot = false
view_image = false
apps = false
plugins = false
remote_plugin = false
browser_use = false
browser_use_external = false
computer_use = false
multi_agent = false
memories = false
workspace_dependencies = false
skill_search = false
skip_host_skill_discovery = true
hooks = false
code_mode = false
code_mode_host = false
goals = false
sleep_tool = false
image_generation = false
[permissions.island.filesystem]
":root" = "deny"
[permissions.island.network]
enabled = false
`;
/** A private runtime home with a copy of existing login credentials; never imports user config/plugins/MCP servers. */
export async function createIsolatedRuntime(): Promise<CodexRuntime> {
  const directory = await mkdtemp(join(tmpdir(), "agent-island-codex-"));
  await chmod(directory, 0o700);
  const cwd = join(directory, "island");
  await mkdir(cwd, { mode: 0o700 });
  try {
    const loginHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
    try {
      await copyFile(
        join(loginHome, "auth.json"),
        join(directory, "auth.json"),
      );
      await chmod(join(directory, "auth.json"), 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("CODEX_CREDENTIAL_COPY_FAILED");
      if (!process.env.OPENAI_API_KEY)
        throw new Error("CODEX_LOGIN_REQUIRED: run codex login first");
    }
    await writeFile(join(directory, "config.toml"), ISLAND_CONFIG, {
      mode: 0o600,
    });
    const env: NodeJS.ProcessEnv = { CODEX_HOME: directory };
    for (const key of [
      "PATH",
      "HOME",
      "USER",
      "LOGNAME",
      "TMPDIR",
      "SYSTEMROOT",
      "SSL_CERT_FILE",
      "SSL_CERT_DIR",
      "NODE_EXTRA_CA_CERTS",
      "HTTPS_PROXY",
      "HTTP_PROXY",
      "NO_PROXY",
      "OPENAI_API_KEY",
    ])
      if (process.env[key]) env[key] = process.env[key];
    const spawnRpc = () =>
      new AppServerRpc(
        process.env.AGENT_ISLAND_CODEX_BIN ?? "codex",
        ["app-server", "--stdio", "--strict-config"],
        { cwd, env },
      );
    let rpc = spawnRpc();
    let closed = false;
    return {
      get rpc() {
        return rpc;
      },
      cwd,
      async restart() {
        await rpc.close();
        rpc = spawnRpc();
        return rpc;
      },
      async close() {
        if (closed) return;
        closed = true;
        await rpc.close();
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
