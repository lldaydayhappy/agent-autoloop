// Failure modes: a blank entry in PATH, which a trailing `;` leaves behind, makes the current folder a place findOnPath
// searches — so a project holding its own `tool.exe` answers for `tool`, and that program runs in place of the installed one;
// a `.ps1` a rule names is handed straight to spawn, which refuses it, or its arguments are joined into shell source; a
// `.bat`, or a `.cmd` whose shim names nothing runnable, is run as shell source, so an Agent's own words become commands.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { POWERSHELL, commandLine, findOnPath } from "../host/command.ts";

const windows = process.platform === "win32";
const scratch = mkdtempSync(join(tmpdir(), "agent-autoloop-command-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

// A blank entry names whatever folder the process is in, so the planted program has to sit in the one the test runs from.
test("a blank PATH entry doesn't make the current folder a place to look", () => {
  const project = join(scratch, "project");
  mkdirSync(project);
  writeFileSync(join(project, "planted.exe"), "");
  const here = process.cwd();
  const path = process.env.PATH;
  try {
    process.chdir(project);
    process.env.PATH = ";";
    assert.equal(findOnPath("planted"), null, "a blank PATH entry searched the current folder");
  } finally {
    if (path === undefined) delete process.env.PATH;
    else process.env.PATH = path;
    process.chdir(here);
  }
});

// A rule's `program` may be a script, and on Windows that is a .ps1. Its arguments are the turn's prompt: one word each,
// never shell source.
test("a .ps1 program runs under the system PowerShell with its arguments as literal words", { skip: !windows }, () => {
  const script = join(scratch, "say.ps1");
  writeFileSync(script, 'Write-Output ("got=" + $args[0])\n');
  const prompt = 'a & echo injected > pwned.txt ; "quoted"';
  const [program, args] = commandLine([script, prompt]);
  assert.equal(program, POWERSHELL, "a .ps1 runs under the system PowerShell, not whatever a folder puts first");
  assert.deepEqual(args.slice(-3), ["-File", script, prompt]);
  const run = spawnSync(program, args, { encoding: "utf8", cwd: scratch });
  assert.equal(run.stdout.trim(), `got=${prompt}`, run.stderr);
  assert.ok(!existsSync(join(scratch, "pwned.txt")), "the argument was read as shell source");
});

test("a .bat program is refused instead of being run as shell source", { skip: !windows }, () => {
  const batch = join(scratch, "run.bat");
  writeFileSync(batch, "@echo off\r\necho %1 > ran.txt\r\n");
  assert.throws(() => commandLine([batch, "x"]), /不能直接运行/);
  assert.ok(!existsSync(join(scratch, "ran.txt")));
});

// npm's shims name their script so it can be run directly, and that is the only shape taken. One that names nothing
// runnable is not a shim.
test("a .cmd that names nothing runnable is refused instead of being run as shell source", { skip: !windows }, () => {
  const shim = join(scratch, "opaque.cmd");
  writeFileSync(shim, "@echo off\r\necho %1 > ran.txt\r\n");
  assert.throws(() => commandLine([shim, "x"]), /不能直接运行/);
  assert.ok(!existsSync(join(scratch, "ran.txt")));
});
