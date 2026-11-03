#!/usr/bin/env bun
// QManager modem bridge: a local stdio MCP server holding one persistent SSH
// connection to one test device, picked by `--device rm520n|rg501q`. Credentials
// come from the repo's .env and are never logged or returned. stdout is the MCP
// channel, so diagnostics go to stderr only.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client, type ClientChannel } from "ssh2";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_TIMEOUT_S = 30;
const MAX_TIMEOUT_S = 600;
const MAX_OUTPUT_BYTES = 256 * 1024;

// ---------------------------------------------------------------- env

// Expected serials (CLAUDE.md > Live Device Access); a mismatch means the wrong device answered.
const DEVICES: Record<string, { prefix: string; label: string; serial: string }> = {
  rm520n: { prefix: "RM520N", label: "RM520N-GL", serial: "61368cd2" },
  rg501q: { prefix: "RG501Q", label: "RG501Q-EU", serial: "b7e3d6f1" },
};
const devArg = process.argv[process.argv.indexOf("--device") + 1] ?? "";
const DEVICE = DEVICES[process.argv.includes("--device") ? devArg : "rm520n"];
if (!DEVICE) throw new Error(`unknown --device "${devArg}" (rm520n | rg501q)`);

function loadEnv(): { host: string; port: number; username: string; password: string; serial: string; hostkey: string } {
  const vars: Record<string, string> = {};
  try {
    for (const line of readFileSync(join(REPO_ROOT, ".env"), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      vars[m[1]] = v;
    }
  } catch {
    // fall through to process.env
  }
  // The bare MODEM_* triad is an alias for the RM520N-GL.
  const get = (k: string) => {
    for (const name of [`${DEVICE.prefix}_${k}`, ...(DEVICE.prefix === "RM520N" ? [`MODEM_${k}`] : [])]) {
      const v = process.env[name] || vars[name];
      if (v) return v;
    }
    return "";
  };
  const host = get("IP");
  const username = get("SSH_USER");
  const password = get("SSH_PASSWORD");
  if (!host || !username) throw new Error(`${DEVICE.prefix}_IP / ${DEVICE.prefix}_SSH_USER missing from .env`);
  return { host, port: Number(get("SSH_PORT")) || 22, username, password, serial: get("SERIAL") || DEVICE.serial, hostkey: get("HOSTKEY_SHA256") };
}

const ENV = loadEnv();

// Scrub any accidental echo of the password from text we return.
function redact(s: string): string {
  return ENV.password ? s.split(ENV.password).join("[REDACTED]") : s;
}

// ---------------------------------------------------------------- host key

// Pin from .env (<PREFIX>_HOSTKEY_SHA256, hex) or trust-on-first-use into a gitignored file.
const KNOWN_HOSTS = join(dirname(fileURLToPath(import.meta.url)), ".known_hosts.json");
let hostKeyError = "";

function verifyHostKey(fp: string): boolean {
  const id = `${DEVICE.prefix}@${ENV.host}:${ENV.port}`;
  const pinned = ENV.hostkey.toLowerCase();
  let known: Record<string, string> = {};
  try { known = JSON.parse(readFileSync(KNOWN_HOSTS, "utf8")); } catch {}
  const expected = pinned || known[id];
  if (!expected) {
    known[id] = fp;
    try { writeFileSync(KNOWN_HOSTS, JSON.stringify(known, null, 2)); } catch {}
    console.error(`[modem-mcp] recorded host key for ${DEVICE.label} (sha256 ${fp})`);
    return true;
  }
  if (fp === expected) return true;
  hostKeyError = `host key mismatch for ${DEVICE.label}: got sha256 ${fp}, expected ${expected}. ` +
    `If the device was reflashed, remove its entry from tools/modem-mcp/.known_hosts.json.`;
  return false;
}

// ---------------------------------------------------------------- connection

let conn: Client | null = null;
let connecting: Promise<Client> | null = null;

function connect(): Promise<Client> {
  if (conn) return Promise.resolve(conn);
  if (connecting) return connecting;
  connecting = new Promise<Client>((res, rej) => {
    const c = new Client();
    let settled = false;
    // Prove which device answered before any call runs on it.
    c.on("ready", () => {
      execOnce(c, "grep -o 'androidboot.serialno=[^ ]*' /proc/cmdline", 10).then((r) => {
        const got = r.stdout.trim().replace(/^androidboot\.serialno=/, "");
        settled = true;
        connecting = null;
        if (got !== ENV.serial) {
          c.end();
          return rej(new Error(`wrong device at ${DEVICE.prefix}_IP: serial "${got}", expected ${DEVICE.label} "${ENV.serial}"`));
        }
        conn = c;
        res(c);
      }, (e) => {
        settled = true;
        connecting = null;
        c.end();
        rej(new Error(`serial check failed: ${redact(String(e))}`));
      });
    });
    c.on("error", (err) => {
      if (conn === c) conn = null;
      if (!settled) {
        settled = true;
        connecting = null;
        rej(new Error(hostKeyError || `SSH connect failed: ${redact(err.message)}`));
      }
    });
    c.on("close", () => {
      if (conn === c) conn = null;
    });
    // Dropbear on the modem may offer only keyboard-interactive; answer password prompts only.
    c.on("keyboard-interactive", (_n, _i, _l, prompts, finish) =>
      finish(prompts.map((pr) => (/pass(word|code)/i.test(pr.prompt) ? ENV.password : ""))));
    c.connect({
      host: ENV.host,
      port: ENV.port,
      username: ENV.username,
      password: ENV.password,
      tryKeyboard: true,
      hostHash: "sha256",
      hostVerifier: (fp: string) => verifyHostKey(fp),
      readyTimeout: 15000,
      keepaliveInterval: 15000,
      keepaliveCountMax: 3,
    });
  });
  return connecting;
}

type Orphan = { pid: number; state: string; cmd: string };
type ExecResult = {
  stdout: string; stderr: string; exit_code: number | null;
  timed_out?: boolean; cancelled?: boolean; truncated?: boolean; orphans?: Orphan[];
};

// Process-tree containment. The device has no setsid/pkill and dropbear does
// not give exec channels their own session, so every command runs with a
// random QM_MCP_RUN=<token> in its environment. Descendants inherit it, and
// it stays visible in /proc/<pid>/environ even after a child is reparented to
// init, so `grep -lsF` over /proc finds the whole tree. The kill freezes the
// tree (STOP) before signalling so nothing can fork its way out.
const MARK_TIMEOUT = "__QM_MCP_TIMEOUT__";
const MARK_ORPHAN = "__QM_MCP_ORPHAN__";

function treeFns(tok: string): string {
  return (
    `qm_pids() { grep -lsF 'QM_MCP_RUN=${tok}' /proc/[0-9]*/environ 2>/dev/null | sed 's#^/proc/##;s#/environ$##'; }; ` +
    `qm_kill() { p=$(qm_pids); [ -n "$p" ] || return 0; kill -STOP $p 2>/dev/null; p="$p $(qm_pids)"; ` +
    `kill -TERM $p 2>/dev/null; kill -CONT $p 2>/dev/null; sleep 1; p=$(qm_pids); [ -n "$p" ] && kill -KILL $p 2>/dev/null; sleep 0.2; }; ` +
    // Survivors after SIGKILL are D-state (e.g. stuck in a glink read) or zombies.
    `qm_report() { for p in $(qm_pids); do s=$(cut -d' ' -f3 /proc/$p/stat 2>/dev/null); ` +
    `c=$(tr '\\0' ' ' < /proc/$p/cmdline 2>/dev/null); echo "${MARK_ORPHAN} $p $s $c" >&2; done; }; `
  );
}

// Wrap a command so the device itself enforces the budget: a watchdog sleeps
// timeoutS, then kills the tagged tree. This holds even if the SSH channel or
// the bridge dies. stdin is /dev/null unless the caller supplied input.
function wrap(command: string, tok: string, timeoutS: number, withStdin: boolean): string {
  const mk = `/tmp/.qm_mcp_to_${tok}`;
  return (
    treeFns(tok) +
    (withStdin ? `exec 3<&0; QM_MCP_RUN=${tok} sh -c ${sq(command)} <&3 3<&- & ` : `QM_MCP_RUN=${tok} sh -c ${sq(command)} </dev/null & `) +
    `qm_pid=$!; ` +
    `( sleep ${timeoutS}; : > ${mk}; qm_kill ) </dev/null >/dev/null 2>&1 & qm_wd=$!; ` +
    `wait $qm_pid; qm_rc=$?; ` +
    `if [ -f ${mk} ]; then wait $qm_wd; rm -f ${mk}; echo ${MARK_TIMEOUT} >&2; qm_report; exit 124; fi; ` +
    // Freeze the watchdog so it cannot fork mid-teardown, then drop it and its sleep.
    `kill -STOP $qm_wd 2>/dev/null; kill -KILL $(pgrep -P $qm_wd) $qm_wd 2>/dev/null; wait $qm_wd 2>/dev/null; ` +
    `exit $qm_rc`
  );
}

// Kill a run's tree from a fresh channel (client backstop, cancellation,
// shutdown) and report anything that survived.
async function killTree(tok: string): Promise<Orphan[]> {
  const c = await connect();
  const r = await execOnce(c, treeFns(tok) + `qm_kill; qm_report`, 15).catch(() => null);
  return r ? parseOrphans(r.stderr).orphans : [];
}

function parseOrphans(stderr: string): { rest: string; orphans: Orphan[]; timedOut: boolean } {
  const orphans: Orphan[] = [];
  let timedOut = false;
  const rest = stderr.split("\n").filter((l) => {
    if (l === MARK_TIMEOUT) { timedOut = true; return false; }
    const m = l.match(new RegExp(`^${MARK_ORPHAN} (\\d+) (\\S*) ?(.*)$`));
    if (!m) return true;
    orphans.push({ pid: Number(m[1]), state: m[2], cmd: m[3].trim() });
    return false;
  }).join("\n");
  return { rest, orphans, timedOut };
}

const activeRuns = new Set<string>();

function execOnce(c: Client, command: string, timeoutS: number, stdin?: string, signal?: AbortSignal): Promise<ExecResult> {
  return new Promise((res, rej) => {
    c.exec(command, (err, ch: ClientChannel) => {
      if (err) return rej(err);
      const out: Buffer[] = [];
      const errb: Buffer[] = [];
      let outLen = 0;
      let errLen = 0;
      let truncated = false;
      let code: number | null = null;
      let timedOut = false;
      let cancelled = false;
      let done = false;
      // Dropbear does not confirm a channel close while the remote process is
      // alive, so after aborting we finish without waiting for "close"; the
      // caller then kills the tree from a fresh channel.
      const abort = () => {
        try { ch.signal("KILL"); } catch {}
        try { ch.close(); } catch {}
        setTimeout(finish, 1000);
      };
      const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutS * 1000);
      const onAbort = () => { cancelled = true; abort(); };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
      ch.on("data", (d: Buffer) => {
        if (outLen < MAX_OUTPUT_BYTES) out.push(d); else truncated = true;
        outLen += d.length;
      });
      ch.stderr.on("data", (d: Buffer) => {
        if (errLen < MAX_OUTPUT_BYTES) errb.push(d); else truncated = true;
        errLen += d.length;
      });
      ch.on("exit", (c2: number | null) => { code = c2; });
      function finish() {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        const r: ExecResult = {
          stdout: redact(Buffer.concat(out).subarray(0, MAX_OUTPUT_BYTES).toString("utf8")),
          stderr: redact(Buffer.concat(errb).subarray(0, MAX_OUTPUT_BYTES).toString("utf8")),
          exit_code: timedOut || cancelled ? null : code,
        };
        if (timedOut) r.timed_out = true;
        if (cancelled) r.cancelled = true;
        if (truncated) r.truncated = true;
        res(r);
      }
      ch.on("close", finish);
      if (stdin !== undefined) ch.end(stdin);
      else ch.end();
    });
  });
}

// Run a command inside the containment wrapper, reconnecting once if the
// connection dropped underneath us. The device watchdog fires at timeoutS; the
// client timer is a backstop a few seconds later that kills the tree itself.
async function run(command: string, timeoutS = DEFAULT_TIMEOUT_S, stdin?: string, signal?: AbortSignal): Promise<ExecResult> {
  const t = Math.min(Math.max(Math.ceil(timeoutS), 1), MAX_TIMEOUT_S);
  const tok = randomBytes(8).toString("hex");
  const cmd = wrap(command, tok, t, stdin !== undefined);
  activeRuns.add(tok);
  try {
    for (let attempt = 0; ; attempt++) {
      const c = await connect();
      try {
        const r = await execOnce(c, cmd, t + 8, stdin, signal);
        const p = parseOrphans(r.stderr);
        r.stderr = p.rest;
        if (p.timedOut) { r.timed_out = true; r.exit_code = null; }
        if (r.timed_out || r.cancelled) {
          // Device watchdog already reported survivors; otherwise kill from here.
          r.orphans = p.timedOut ? p.orphans : await killTree(tok);
        }
        return r;
      } catch (e) {
        if (conn === c) { conn = null; try { c.end(); } catch {} }
        if (attempt >= 1) throw e;
      }
    }
  } finally {
    activeRuns.delete(tok);
  }
}

// On bridge shutdown, kill whatever is still running on the device.
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const toks = [...activeRuns];
  if (toks.length && conn) {
    await Promise.race([
      Promise.all(toks.map((t) => killTree(t))),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.stdin.on("close", shutdown);

// ---------------------------------------------------------------- guard rails

const DENY: { name: string; re: RegExp }[] = [
  // Command position only, so `grep reboot crash.log` stays allowed.
  { name: "reboot/poweroff/halt", re: /(^|[;&|`(]|\$\(|\b(then|do|else|exec|nohup|sudo))\s*(\/s?bin\/|\/usr\/s?bin\/)?(reboot|poweroff|halt)\b/im },
  { name: "AT+CFUN=1,1", re: /AT\+CFUN\s*=\s*1\s*,\s*1/i },
  { name: "firstboot", re: /\bfirstboot\b/i },
  { name: "factory reset", re: /factory[\s_-]*reset|\bjffs2reset\b|AT\+QPRTPARA\s*=\s*3|AT&F/i },
  { name: "rm -rf /", re: /\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rR][a-zA-Z]*\s+(-[a-zA-Z]*\s+)*\/(\*|\s|$|[;&|])/ },
  { name: "opkg remove", re: /\bopkg\s+(remove|uninstall)\b/i },
  { name: "mtd/dd to block device", re: /\bmtd\s+(erase|write)\b|\bdd\b[^\n]*\bof=\/dev\//i },
  { name: "systemctl reboot/poweroff/halt", re: /\bsystemctl\s+(-\S+\s+)*(reboot|poweroff|halt|kexec|rescue|emergency)\b/i },
  { name: "AT+QPOWD", re: /AT\+QPOWD/i },
  { name: "flash erase/format", re: /\b(flash_erase|ubiformat|ubirmvol|mkfs(\.\w+)?)\b/i },
];

function denied(text: string): string | null {
  for (const d of DENY) if (d.re.test(text)) return d.name;
  return null;
}

function refusal(rule: string) {
  return {
    isError: true,
    content: [{
      type: "text" as const,
      text: `Refused: command matches deny rule "${rule}". Re-call with confirm:true only if the user explicitly approved this destructive action.`,
    }],
  };
}

function json(obj: unknown, isError = false) {
  return { isError, content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

function fail(e: unknown) {
  return { isError: true, content: [{ type: "text" as const, text: redact(e instanceof Error ? e.message : String(e)) }] };
}

const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// ---------------------------------------------------------------- server

const server = new McpServer({ name: `modem-${DEVICE.prefix.toLowerCase()}`, version: "0.1.0" });

server.registerTool(
  "modem_exec",
  {
    description:
      `Run a shell command on the live ${DEVICE.label} test device (BusyBox /bin/sh as root over a persistent SSH connection; the serial is checked on connect). ` +
      "Rootfs / is mounted ro; /etc, /usrdata, /opt and /tmp are rw. " +
      "Returns {stdout, stderr, exit_code}. stdin is /dev/null unless `stdin` is given, so interactive tools (REPLs, prompts) get EOF instead of hanging; " +
      "drive a REPL by passing its input, e.g. stdin:\"nw_reg\\nquit\\n\". The timeout is enforced on the device: when timeout_s expires the whole remote " +
      "process tree (including backgrounded children) is stopped, sent TERM, then KILL, and the result has timed_out:true, partial output, and " +
      "orphans:[{pid,state,cmd}] for anything that survived (normally empty; D-state processes cannot be killed). Cancelling the call kills the tree too. " +
      "Background jobs left running after a command finishes normally are not killed. " +
      "Destructive commands (reboot, systemctl reboot/poweroff, AT+CFUN=1,1, AT+QPOWD, firstboot, factory reset, rm -rf /, opkg remove, flash erase/format) are refused unless confirm:true.",
    inputSchema: {
      command: z.string().min(1),
      timeout_s: z.number().positive().max(MAX_TIMEOUT_S).optional().describe(`default ${DEFAULT_TIMEOUT_S}; enforced on-device`),
      stdin: z.string().optional().describe("Input fed to the command, then EOF. Omit for /dev/null."),
      confirm: z.boolean().optional().describe("Bypass the deny-list; only with explicit user approval"),
    },
  },
  async ({ command, timeout_s, stdin, confirm }, extra) => {
    const rule = denied(command) ?? (stdin !== undefined ? denied(stdin) : null);
    if (rule && !confirm) return refusal(rule);
    try {
      const r = await run(command, timeout_s, stdin, extra.signal);
      return json(r, !!r.timed_out || !!r.cancelled);
    } catch (e) { return fail(e); }
  },
);

// Pids of the bridge's own plumbing: this run's tree (env token) and every
// bridge wrapper shell (token in argv). Processes merely started by an earlier
// run, e.g. a nohup'd job, stay visible and killable.
const SELF_PIDS =
  `x=" $( { grep -lsF "QM_MCP_RUN=$QM_MCP_RUN" /proc/[0-9]*/environ; grep -lsF QM_MCP_RUN= /proc/[0-9]*/cmdline; } ` +
  `| sed 's#^/proc/##;s#/[a-z]*$##' | tr '\\n' ' ') "; `;

// BusyBox ps, minus the bridge's own plumbing.
const PS_SCRIPT =
  SELF_PIDS +
  `ps -o pid,ppid,stat,args | sed 1d | while read p pp s c; do case "$x" in *" $p "*) continue;; esac; echo "$p $pp $s $c"; done`;

server.registerTool(
  "modem_ps",
  {
    description:
      "List processes on the modem (works without procps/pkill). Returns [{pid, ppid, state, cmd}], optionally filtered by a case-sensitive substring of the command line. " +
      "Kernel threads show as [name].",
    inputSchema: {
      pattern: z.string().optional().describe("substring to match against the full command line"),
    },
  },
  async ({ pattern }, extra) => {
    try {
      const r = await run(PS_SCRIPT, 20, undefined, extra.signal);
      if (r.exit_code !== 0) return json(r, true);
      const rows = r.stdout.split("\n").filter(Boolean).map((l) => {
        const m = l.match(/^(\d+) (\d+) (\S+) (.*)$/);
        return m ? { pid: Number(m[1]), ppid: Number(m[2]), state: m[3], cmd: m[4].trim() } : null;
      }).filter((x): x is { pid: number; ppid: number; state: string; cmd: string } => !!x && (!pattern || x.cmd.includes(pattern)));
      return json(rows);
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  "modem_kill",
  {
    description:
      "Kill processes on the modem by pid or by command-line pattern (pgrep -f regex + kill; the device has no pkill). " +
      "Signal defaults to TERM, then KILL for anything still alive after 1 s (escalate:false to send only the given signal). " +
      "PID 1 is never touched; more than 5 pattern matches need confirm:true. Returns {matched:[{pid,cmd}], survivors:[...]}.",
    inputSchema: {
      pid: z.number().int().positive().optional(),
      pattern: z.string().min(1).optional().describe("regex matched against the full command line (pgrep -f)"),
      signal: z.enum(["TERM", "KILL", "INT", "HUP", "STOP", "CONT"]).optional(),
      escalate: z.boolean().optional().describe("default true: KILL survivors of TERM after 1 s"),
      confirm: z.boolean().optional().describe("Allow more than 5 matches or a deny-listed pattern"),
    },
  },
  async ({ pid, pattern, signal, escalate, confirm }, extra) => {
    if ((pid === undefined) === (pattern === undefined)) return fail("pass exactly one of pid or pattern");
    if (pid === 1) return fail("refusing to signal PID 1 (systemd)");
    if (pattern !== undefined) {
      const rule = denied(pattern);
      if (rule && !confirm) return refusal(rule);
    }
    const sig = signal ?? "TERM";
    const esc = escalate ?? true;
    // Pattern matches exclude the bridge's own plumbing (whose argv contains
    // the pattern) and PID 1.
    const select = pid !== undefined
      ? `ps_=${pid}; [ -d /proc/${pid} ] || ps_=`
      : SELF_PIDS + `ps_=; for p in $(pgrep -f ${sq(pattern!)}); do [ "$p" = 1 ] && continue; case "$x" in *" $p "*) continue;; esac; ps_="$ps_ $p"; done`;
    const show = `for p in $1; do [ -d /proc/$p ] && echo "$2 $p $(tr '\\0' ' ' < /proc/$p/cmdline 2>/dev/null)"; done`;
    const cmd =
      `show() { ${show}; }; ${select}; show "$ps_" M; ` +
      `n=$(echo $ps_ | wc -w); if [ "$n" -gt 5 ] && [ "${confirm ? 1 : 0}" != 1 ]; then echo TOO_MANY >&2; exit 3; fi; ` +
      `[ -n "$ps_" ] || exit 0; kill -${sig} $ps_ 2>/dev/null; ` +
      (esc && sig === "TERM" ? `sleep 1; for p in $ps_; do [ -d /proc/$p ] && kill -KILL $p 2>/dev/null; done; sleep 0.2; ` : `sleep 0.2; `) +
      `show "$ps_" S; exit 0`;
    try {
      const r = await run(cmd, 20, undefined, extra.signal);
      const rows = (tag: string) => r.stdout.split("\n").filter((l) => l.startsWith(tag + " ")).map((l) => {
        const m = l.match(/^\S+ (\d+) ?(.*)$/)!;
        return { pid: Number(m[1]), cmd: m[2].trim() };
      });
      if (r.exit_code === 3) return json({ refused: "more than 5 matches; re-call with confirm:true if intended", matched: rows("M") }, true);
      if (r.exit_code !== 0) return json(r, true);
      const survivors = rows("S");
      return json({ signal: sig, matched: rows("M"), survivors }, survivors.length > 0 && sig !== "STOP" && sig !== "CONT");
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  "modem_read",
  {
    description: "Read a file on the modem. Returns {path, size, content, truncated}.",
    inputSchema: {
      path: z.string().min(1),
      max_bytes: z.number().int().positive().max(MAX_OUTPUT_BYTES).optional().describe("default 65536"),
    },
  },
  async ({ path, max_bytes }, extra) => {
    const n = max_bytes ?? 65536;
    try {
      const r = await run(`[ -f ${sq(path)} ] || { echo "not a file: ${path.replace(/["$`\\]/g, "")}" >&2; exit 2; }; wc -c < ${sq(path)}; head -c ${n} ${sq(path)}`, DEFAULT_TIMEOUT_S, undefined, extra.signal);
      if (r.exit_code !== 0) return json(r, true);
      const nl = r.stdout.indexOf("\n");
      const size = Number(r.stdout.slice(0, nl).trim());
      return json({ path, size, truncated: size > n, content: r.stdout.slice(nl + 1) });
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  "modem_write",
  {
    description:
      "Write a file on the modem crash-safely: content is streamed into a temp file beside the target (no SFTP/base64 needed), CRLF stripped, " +
      "an existing target's owner and mode kept (www-data owns much of /etc/qmanager), new files get `mode` or 644 / 755 for .sh, size and (for .sh) `sh -n` checked, " +
      "then synced and renamed over the target. A failed check leaves the target untouched. Rootfs paths fail until `/` is remounted rw. " +
      "Returns {path, bytes, expected_bytes, mode, syntax_ok, syntax_error, replaced}.",
    inputSchema: {
      path: z.string().min(1).regex(/^\//, "absolute path required"),
      content: z.string(),
      mode: z.string().regex(/^[0-7]{3,4}$/).optional(),
      mkdir: z.boolean().optional().describe("create parent directory first"),
      confirm: z.boolean().optional().describe("Bypass the deny-list for content; only with explicit user approval"),
    },
  },
  async ({ path, content, mode, mkdir, confirm }, extra) => {
    const body = content.replace(/\r\n?/g, "\n");
    const isSh = /\.sh$/.test(path) || body.startsWith("#!/bin/sh");
    const rule = isSh ? denied(body) : null;
    if (rule && !confirm) return refusal(rule);
    const fallback = isSh ? "755" : "644";
    const expected = Buffer.byteLength(body);
    const p = sq(path);
    const parent = sq(path.replace(/\/[^/]*$/, "") || "/");
    // Crash-safe replace: the modem's /usr, /www and /etc sit on UBIFS with a
    // 30 s dirty_expire, and a plain `cat > target` followed by a daemon
    // restart and an AP hang has left files 0 bytes. So stream into a temp
    // file beside the target, check size (+ `sh -n`), sync, rename over the
    // target, sync. A failed check leaves the target untouched. A symlinked
    // target is resolved so the link itself survives, as with `cat >`.
    const cmd =
      `${mkdir ? `mkdir -p ${parent} && ` : ""}` +
      `if [ -L ${p} ]; then d=$(readlink -f ${p}); else d=${p}; fi; o=; em=; ` +
      `if [ -e "$d" ]; then o=$(stat -c %u:%g "$d") && em=$(stat -c %a "$d") || exit 1; fi; ` +
      `mm=${mode ?? `\${em:-${fallback}}`}; ` +
      // mktemp creates exclusively, so a pre-planted name or symlink in a www-data dir cannot redirect the write.
      `t=$(mktemp "$d.tmp.XXXXXX") || exit 1; ` +
      `{ cat > "$t" && chmod "$mm" "$t" && { [ -z "$o" ] || chown "$o" "$t"; }; } || { rm -f "$t"; exit 1; }; ` +
      `echo "$mm"; n=$(wc -c < "$t" | tr -d ' '); echo "$n"; ` +
      `if [ "$n" != "${expected}" ]; then rm -f "$t"; echo NOT_REPLACED; exit 0; fi; ` +
      (isSh
        ? `if sh -n "$t" 2>&1; then echo SYNTAX_OK; else echo SYNTAX_FAIL; rm -f "$t"; echo NOT_REPLACED; exit 0; fi; `
        : "") +
      `{ sync && mv -f "$t" "$d" && sync; } || { rm -f "$t"; exit 1; }; echo REPLACED`;
    try {
      const r = await run(cmd, 60, body, extra.signal);
      if (r.exit_code !== 0) return json(r, true);
      const lines = r.stdout.trimEnd().split("\n");
      const bytes = Number(lines[1]);
      const res: Record<string, unknown> = { path, bytes, expected_bytes: expected, mode: lines[0] };
      if (isSh) {
        const at = lines.findIndex((l) => l === "SYNTAX_OK" || l === "SYNTAX_FAIL");
        res.syntax_ok = at >= 0 && lines[at] === "SYNTAX_OK";
        if (!res.syntax_ok)
          res.syntax_error =
            at >= 0
              ? lines.slice(2, at).join("\n").replace(/\.tmp\.[A-Za-z0-9]{6}/g, "")
              : "not checked (size mismatch)";
      }
      res.replaced = lines[lines.length - 1] === "REPLACED";
      return json(res, !res.replaced);
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  "modem_cgi",
  {
    description:
      "Call a QManager CGI endpoint on-device via curl to https://127.0.0.1[:port]/cgi-bin/quecmanager/<endpoint> (port from /usrdata/qmanager/web_port) through lighttpd, so the CGI runs as www-data " +
      "(plain http 301s to https). Authenticates with a throwaway session minted on-device and removed afterwards. Returns {status, body} (body parsed as JSON when possible).",
    inputSchema: {
      endpoint: z.string().min(1).describe("e.g. 'at_cmd/fetch_data.sh' or 'system/settings.sh?x=1'"),
      method: z.enum(["GET", "POST", "PUT", "DELETE"]).optional(),
      body: z.union([z.string(), z.record(z.string(), z.unknown())]).optional().describe("request body; objects are JSON-encoded"),
      timeout_s: z.number().positive().max(MAX_TIMEOUT_S).optional(),
    },
  },
  async ({ endpoint, method, body, timeout_s }, extra) => {
    const ep = endpoint.replace(/^\/+/, "").replace(/^cgi-bin\/quecmanager\//, "");
    if (/(^|\/)\.\.(\/|$)/.test(ep)) return fail("endpoint may not contain ..");
    const m = method ?? (body !== undefined ? "POST" : "GET");
    const payload = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const tok = randomBytes(32).toString("hex");
    const sess = `/tmp/qmanager_sessions/${tok}`;
    const t = Math.min(timeout_s ?? DEFAULT_TIMEOUT_S, MAX_TIMEOUT_S);
    // The HTTPS port comes from the web port file (missing = 443).
    const port = `p=$(sed -n 's/^https=\\([0-9]*\\)$/\\1/p' /usrdata/qmanager/web_port 2>/dev/null); p=\${p:-443}`;
    const curl =
      `curl -sk -m ${t} -X ${m} -H 'Cookie: qm_session=${tok}' ` +
      (payload !== undefined ? `-H 'Content-Type: application/json' --data-binary @- ` : "") +
      `-w '\\n__HTTP_STATUS__%{http_code}' "https://127.0.0.1:$p/cgi-bin/quecmanager/"${sq(ep)}`;
    // A root-created sessions dir would lock www-data out of its own sessions.
    const dir = `[ -d /tmp/qmanager_sessions ] || { mkdir -p /tmp/qmanager_sessions && chown www-data /tmp/qmanager_sessions; }`;
    const cmd = `${dir}; ${port}; date +%s > ${sess}; ${curl}; rc=$?; rm -f ${sess}; exit $rc`;
    try {
      const r = await run(cmd, t + 5, payload, extra.signal);
      const idx = r.stdout.lastIndexOf("\n__HTTP_STATUS__");
      const status = idx >= 0 ? Number(r.stdout.slice(idx + 16).trim()) : null;
      const raw = idx >= 0 ? r.stdout.slice(0, idx) : r.stdout;
      let parsed: unknown = raw;
      try { parsed = JSON.parse(raw); } catch {}
      return json({ status, body: parsed, ...(r.exit_code ? { curl_exit: r.exit_code, stderr: r.stderr } : {}) },
        r.exit_code !== 0 || !status || status >= 400);
    } catch (e) { return fail(e); }
  },
);

await server.connect(new StdioServerTransport());
console.error(`[modem-mcp] ready (${DEVICE.label} from .env)`);
