// `doctor` says what is wrong on this machine, and its exit status has to carry that, or a script reading it sees a
// broken install as fine. Failure cases: a machine that was never set up reports what is missing but ends 0; a hub that
// refuses the connection is reported but ends 0; the status is set only once at the end, so the one path that returns
// early loses it. Both cases here need no service manager, so they run on every platform.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const root = join(import.meta.dirname, "..");
const home = mkdtempSync(join(tmpdir(), "agent-autoloop-doctor-"));
after(() => rmSync(home, { recursive: true, force: true }));

const doctor = (env: NodeJS.ProcessEnv) => {
  const clean = { ...process.env, ...env };
  delete clean.AGENT_AUTOLOOP_RULES;
  return spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "bin/agent-autoloop.ts", "doctor"], {
    cwd: root,
    env: clean,
    encoding: "utf8",
    timeout: 60_000,
  });
};

test("a machine that was never set up is told so, and the status says it isn't fine", () => {
  const unset = join(home, "nothing-installed");
  const done = doctor({ AGENT_AUTOLOOP_HOME: unset });
  assert.match(done.stdout, /还没装好/);
  assert.equal(done.status, 1, "the status a script reads has to be a failure");
});

test("a hub that refuses the connection is reported, and the status says it isn't fine", async () => {
  const port = await new Promise<number>((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
  const configured = join(home, "configured");
  mkdirSync(configured);
  writeFileSync(
    join(configured, "config.json"),
    JSON.stringify({ url: `http://127.0.0.1:${port}`, worker: { name: "w", key: "k" } }),
  );
  const done = doctor({ AGENT_AUTOLOOP_HOME: configured });
  assert.match(done.stdout, /连不上中台/);
  assert.equal(done.status, 1, "the status a script reads has to be a failure");
});
