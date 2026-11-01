import { describe, expect, it } from "vitest";
import { AppServerRpc } from "./AppServerRpc.js";
const fixture = `const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const m=JSON.parse(line);if(m.method==='hang')return;if(m.method==='die'){process.exit(1);return;}if(m.method==='bad'){process.stdout.write('not-json\\n');return;}if(m.method==='error'){process.stdout.write(JSON.stringify({id:m.id,error:{code:-1,message:'test'}})+'\\n');return;}process.stdout.write(JSON.stringify({id:m.id,result:{echo:m.params}})+'\\n');});`;
describe("app-server JSON-RPC transport", () => {
  it("matches concurrent responses by ID and rejects protocol errors", async () => {
    const rpc = new AppServerRpc(process.execPath, ["-e", fixture]);
    try {
      expect(
        await Promise.all([
          rpc.request("echo", { id: 1 }),
          rpc.request("echo", { id: 2 }),
        ]),
      ).toEqual([{ echo: { id: 1 } }, { echo: { id: 2 } }]);
      await expect(rpc.request("error", {})).rejects.toThrow("CODEX_RPC_ERROR");
    } finally {
      await rpc.close();
    }
  });
  it("aborts pending requests and fails fast on child exit", async () => {
    const rpc = new AppServerRpc(process.execPath, ["-e", fixture]);
    try {
      const abort = new AbortController();
      const pending = rpc.request("hang", {}, abort.signal);
      abort.abort();
      await expect(pending).rejects.toThrow("DECISION_CANCELLED");
      await expect(rpc.request("die", {})).rejects.toThrow(
        "CODEX_PROCESS_EXITED",
      );
      expect(rpc.isAlive()).toBe(false);
    } finally {
      await rpc.close();
    }
  });
  it("bounds request latency and rejects malformed stdout", async () => {
    const rpc = new AppServerRpc(process.execPath, ["-e", fixture], {}, 100);
    try {
      await expect(rpc.request("hang", {})).rejects.toThrow(
        "CODEX_RPC_TIMEOUT",
      );
      await expect(rpc.request("bad", {})).rejects.toThrow(
        "INVALID_APP_SERVER_MESSAGE",
      );
    } finally {
      await rpc.close();
    }
  });
});
