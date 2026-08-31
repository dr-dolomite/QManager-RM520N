/* QManager Installer — UI controller.
 *
 * Every user-visible string comes from the locale files through t(); there are
 * no English literals below. Every decision the installer makes was already
 * made in core/ and reaches us as data — this file renders it and never
 * re-derives it.
 */

"use strict";

let STRINGS = {};
let POLL = null;
let HOST = null; // the SSH host the user typed, or null over ADB

const api = () => window.pywebview.api;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ---------- i18n ---------- */

function t(key, params) {
  let s = STRINGS[key];
  if (s === undefined || s === "") return key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split("{" + k + "}").join(String(v));
    }
  }
  return s;
}

function applyStaticStrings() {
  for (const el of $$("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }
  // Attribute-only strings (tooltip triggers etc.) — same locale keys as
  // their visible bubble text, just projected onto aria-label instead of
  // textContent since the trigger itself has no visible label.
  for (const el of $$("[data-i18n-aria]")) {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  }
}

/* ---------- theme ----------
 * tokens.css authors light on :root and dark on .dark, exactly as the app
 * does, so the class is the only switch we need.
 */

function applyTheme(isDark) {
  document.documentElement.classList.toggle("dark", isDark);
}

/* ---------- chips ----------
 * Filled tonal chip + a DISTINCT glyph per state. success-container and
 * warning-container measure 1.03:1 apart and are identical under
 * deuteranopia, so the glyph is what actually separates them.
 */

const GLYPH = {
  pass: "#i-pass",
  warn: "#i-warn",
  block: "#i-block",
  info: "#i-info",
  idle: "#i-idle",
};

function chip(tone, label) {
  const el = document.createElement("span");
  el.className = "chip";
  el.dataset.tone = tone;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "glyph");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", GLYPH[tone] || GLYPH.idle);
  svg.appendChild(use);
  el.appendChild(svg);
  el.appendChild(document.createTextNode(label));
  return el;
}

/* ---------- result sound ----------
 * A brief synthesized chime on a terminal outcome, requested directly rather
 * than added on spec — two tones only, no audio file to bundle or license.
 * "cancelled" stays silent: the user stopped the run on purpose, which
 * TERMINAL already treats as distinct from a failure, not an event worth a
 * sound. Web Audio needs a page that has already seen user interaction
 * (this one has — Start was clicked to get here); if it's unavailable or the
 * browser blocks it, the result screen is already fully correct without it.
 */

let audioCtx = null;

function playTone(ctx, freq, start, duration, gain, type) {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  amp.gain.setValueAtTime(0, start);
  amp.gain.linearRampToValueAtTime(gain, start + 0.02);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

function playResultSound(resultTone) {
  if (resultTone !== "pass" && resultTone !== "block") return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const now = audioCtx.currentTime;
    if (resultTone === "pass") {
      playTone(audioCtx, 659.25, now, 0.16, 0.14, "sine"); // E5
      playTone(audioCtx, 987.77, now + 0.1, 0.28, 0.12, "sine"); // B5, rising
    } else {
      playTone(audioCtx, 220, now, 0.2, 0.13, "triangle"); // A3
      playTone(audioCtx, 174.61, now + 0.14, 0.32, 0.11, "triangle"); // F3, falling
    }
  } catch (_e) {
    /* Audio is a nicety layered on an already-complete screen, never a
       requirement for it. */
  }
}

/* Splits `text` on the literal `url` substring and renders the rest as plain
 * nodes around a real <a> — the modem address is the one thing on the result
 * screen the user needs to act on, so it opens in their actual browser
 * (Bridge.open_url uses Python's webbrowser module) rather than navigating
 * the WebView itself away from the installer. */
function setLinkedDetail(el, text, url) {
  el.textContent = "";
  const idx = text.indexOf(url);
  if (idx === -1) {
    el.textContent = text;
    return;
  }
  el.append(text.slice(0, idx));
  const a = document.createElement("a");
  a.href = url;
  a.textContent = url;
  a.addEventListener("click", (e) => {
    e.preventDefault();
    api().open_url(url);
  });
  el.appendChild(a);
  el.append(text.slice(idx + url.length));
}

/* ---------- view switching ---------- */

function view(name) {
  document.body.dataset.view = name;
  window.scrollTo({ top: 0 });
}

function showError(el, message) {
  el.textContent = message;
  el.hidden = !message;
}

/* ---------- connect ---------- */

/* One transport is live at a time, so one panel is in the document at a time:
 * the other is `hidden`, which styles.css makes real (a UA `hidden` loses to
 * any author `display`, and .pane has one). Selection also moves the tab stop
 * -- a tablist is one stop, and Tab from the selected tab lands in the panel
 * it selected rather than on the tab beside it. */
function transportTab(which, moveFocus) {
  for (const tab of $$(".tab")) {
    const on = tab.dataset.transport === which;
    tab.classList.toggle("is-active", on);
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    if (on && moveFocus) tab.focus();
  }
  $("#adb-pane").hidden = which !== "adb";
  $("#ssh-pane").hidden = which !== "ssh";
}

async function refreshDevices() {
  const list = $("#devices");
  list.textContent = "";
  const devices = await api().list_devices();

  for (const d of devices) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "device";
    btn.disabled = d.state !== "device";

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "glyph");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#i-device");
    svg.appendChild(use);
    btn.appendChild(svg);

    const text = document.createElement("span");
    const serial = document.createElement("span");
    serial.className = "device-serial";
    serial.textContent = d.serial;
    text.appendChild(serial);
    if (d.model) {
      const meta = document.createElement("span");
      meta.className = "device-meta";
      meta.textContent = " " + d.model;
      text.appendChild(meta);
    }
    btn.appendChild(text);

    if (d.state === "unauthorized") {
      btn.appendChild(chip("warn", t("device.unauthorized")));
      btn.title = t("device.unauthorized.help");
    } else if (d.state !== "device") {
      btn.appendChild(chip("idle", d.state));
    }

    btn.addEventListener("click", () => connectAdb(d.serial));
    li.appendChild(btn);
    list.appendChild(li);
  }

  $("#no-device").hidden = devices.length > 0;
}

async function connectAdb(serial) {
  showError($("#connect-error"), "");
  const res = await api().connect_adb(serial);
  if (!res.connected) {
    showError($("#connect-error"), res.error.message);
    return;
  }
  HOST = res.host;
  await runPreflight();
}

async function connectSsh() {
  showError($("#connect-error"), "");
  const btn = $("#ssh-connect");
  btn.disabled = true;
  try {
    // An empty field means "use the saved password" — the backend decrypts
    // it in Python, so the secret never exists in this JS context.
    const res = await api().connect_ssh(
      $("#ssh-host").value.trim(),
      $("#ssh-user").value.trim(),
      $("#ssh-pass").value,
      $("#ssh-remember").checked
    );
    if (!res.connected) {
      showError($("#connect-error"), res.error.message);
      return;
    }
    HOST = res.host;
    // It is saved now (or deliberately not); either way it should not sit in
    // an input for the rest of the session.
    $("#ssh-pass").value = "";
    applySavedPasswordPlaceholder($("#ssh-remember").checked);
    await runPreflight();
  } finally {
    btn.disabled = false;
  }
}

/* ---------- saved connection ----------
 * The password itself never crosses the bridge: saved_connection() reports
 * has_password as a bool and the field shows a placeholder rather than fake
 * dots, so there is nothing here to leak.
 */

function applySavedPasswordPlaceholder(has) {
  $("#ssh-pass").placeholder = has ? t("transport.ssh.password.saved") : "";
}

async function restoreSavedConnection() {
  const saved = await api().saved_connection();
  if (!saved || !saved.ssh) return;

  $("#ssh-host").value = saved.ssh.host;
  $("#ssh-user").value = saved.ssh.user;
  $("#ssh-remember").checked = Boolean(saved.ssh.remember);
  applySavedPasswordPlaceholder(Boolean(saved.ssh.has_password));

  if (saved.transport === "ssh") transportTab("ssh");
  return saved;
}

/* ---------- preflight ---------- */

const TONE = { pass: "pass", warn: "warn", block: "block", info: "info" };

/* Prefer a translated message over the backend's English detail. The backend
 * detail is a fallback, not the primary voice. */
function checkDetail(c, device) {
  const d = c.data || {};
  switch (c.id) {
    case "model":
      if (device && device.identity_read_ok === false) {
        return t("check.model.identity_unreadable");
      }
      return t("check.model." + (device ? device.tier : "unknown"));
    case "root":
      return c.state === "pass" ? t("check.root.ok") : t("check.root.blocked");
    case "simpleadmin":
      return d.markers && d.markers.length
        ? t("check.simpleadmin.found", { markers: d.markers.join(", ") })
        : t("check.simpleadmin.clean");
    case "disk":
      return t("check.disk.detail", { free: d.free_kb, required: d.required_kb });
    case "entware":
      if (d.raw === "REACHABLE") return t("check.entware.reachable");
      if (d.raw === "UNREACHABLE_HAVE_OPKG") return t("check.entware.have_opkg");
      if (d.raw === "NO_DOWNLOADER") return t("check.entware.none");
      return t("check.entware.unreachable");
    default:
      return c.detail;
  }
}

function renderIdentity(target, device, installed) {
  target.textContent = "";
  if (!device) return;
  const rows = [
    [t("check.identity"), device.serial],
    [t("check.model"), device.project_name || device.firmware_raw],
  ];
  if (installed) rows.push([t("check.existing"), installed]);
  for (const [k, v] of rows) {
    if (!v) continue;
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    target.appendChild(dt);
    target.appendChild(dd);
  }
}

async function runPreflight() {
  const report = await api().preflight();
  if (report.error) {
    showError($("#connect-error"), report.error.message);
    view("connect");
    return;
  }

  $("#payload-version").textContent = report.payload_version;
  $("#action-title").textContent = t("action." + report.action);
  $("#action-detail").textContent = t("action." + report.action + ".detail", {
    version: report.payload_version,
    installed: report.installed_version || "",
  });
  renderIdentity($("#identity"), report.device, report.installed_version);

  const list = $("#checks");
  list.textContent = "";
  for (const c of report.checks) {
    const li = document.createElement("li");
    li.className = "check";
    li.appendChild(chip(TONE[c.state] || "idle", t("check." + c.id)));
    const detail = document.createElement("span");
    detail.className = "check-detail";
    detail.textContent = checkDetail(c, report.device);
    li.appendChild(detail);
    list.appendChild(li);
  }

  $("#start").disabled = report.blocked;
  $("#blocked-note").hidden = !report.blocked;
  $("#uninstall").hidden = !report.installed_version;
  view("preflight");
}

/* ---------- run ---------- */

function renderProgress(p) {
  const dots = $("#dots");
  if (!p) {
    $("#progress-count").textContent = "";
    return;
  }
  if (dots.children.length !== p.total) {
    dots.textContent = "";
    for (let i = 0; i < p.total; i++) {
      const d = document.createElement("span");
      d.className = "dot";
      dots.appendChild(d);
    }
  }
  Array.from(dots.children).forEach((d, i) => {
    d.dataset.done = String(i < p.step);
  });
  dots.setAttribute("aria-label", t("run.step", { step: p.step, total: p.total }));
  $("#progress-count").textContent = t("run.step", { step: p.step, total: p.total });
}

/* Three terminal states, three tones, three distinct glyphs. "cancelled" is
 * deliberately not "failed": nothing went wrong, the user stopped it. Its
 * error field is always null, which is the tell. */
const TERMINAL = {
  done: { tone: "pass", key: "run.done" },
  failed: { tone: "block", key: "run.failed" },
  cancelled: { tone: "warn", key: "run.cancelled" },
};

function finish(snap) {
  const term = TERMINAL[snap.state] || TERMINAL.failed;

  $("#result-hero").dataset.tone = term.tone;
  $("#result-icon-use").setAttribute("href", GLYPH[term.tone] || GLYPH.idle);
  playResultSound(term.tone);

  $("#result-title").textContent = t(term.key);

  if (snap.state === "cancelled") {
    // Say plainly that the device may be half-installed. A cancelled run does
    // not roll back what install_rm520n.sh already wrote.
    $("#result-detail").textContent = t("run.cancelled.detail");
    $("#result-facts").hidden = true;
  } else if (snap.state === "done") {
    // Never invent an address: over ADB the modem's LAN IP is not knowable
    // from the session, so that path gets its own wording. When it IS
    // known, the address is a live link — this is the one thing on the
    // whole screen the user actually needs to act on next.
    if (HOST) {
      setLinkedDetail($("#result-detail"), t("run.done.detail", { ip: HOST }), `http://${HOST}`);
    } else {
      $("#result-detail").textContent = t("run.done.detail.unknown_ip");
    }
    $("#result-facts").hidden = true;
  } else {
    const e = snap.error;
    $("#result-detail").textContent = e
      ? t("run.failed.detail", { step: e.step, code: e.exit_code })
      : t("run.failed");
    // The failure surfaces as structured fields, never as a traceback.
    const facts = $("#result-facts");
    facts.textContent = "";
    if (e) {
      for (const [k, v] of [["$", e.command], ["stderr", e.stderr]]) {
        if (!v) continue;
        const dt = document.createElement("dt");
        dt.textContent = k;
        const dd = document.createElement("dd");
        dd.textContent = v;
        facts.appendChild(dt);
        facts.appendChild(dd);
      }
    }
    facts.hidden = !facts.children.length;
  }

  $("#result-log").textContent = snap.log_path ? t("run.log", { path: snap.log_path }) : "";
  view("result");
}

async function poll() {
  const snap = await api().poll();

  if (snap.lines && snap.lines.length) {
    const log = $("#log");
    log.textContent += snap.lines.join("\n") + "\n";
    log.scrollTop = log.scrollHeight;
  }
  renderProgress(snap.progress);

  if (snap.state === "done" || snap.state === "failed" || snap.state === "cancelled") {
    clearInterval(POLL);
    POLL = null;
    $("#cancel").disabled = false;
    finish(snap);
  }
}

async function start(action) {
  $("#log").textContent = "";
  $("#dots").textContent = "";
  $("#progress-count").textContent = "";
  $("#run-title").textContent = t(action === "uninstall" ? "action.uninstall" : "run.installing");
  $("#cancel").disabled = false;
  view("run");

  const res = await api().start(action, $("#reboot").checked, $("#skip-packages").checked);
  if (!res.started) {
    // Not connected, or a run is already in flight. Go back to where the user
    // can act instead of leaving them on a run view that will never move.
    view("preflight");
    showError($("#blocked-note"), t("error.not_connected"));
    return;
  }
  POLL = setInterval(poll, 500);
}

/* ---------- boot ---------- */

async function loadLocale(locale) {
  if (locale) await api().set_locale(locale);
  STRINGS = await api().strings();
  applyStaticStrings();
}

async function boot() {
  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  applyTheme(dark.matches);
  dark.addEventListener("change", (e) => applyTheme(e.matches));

  // The bridge already loaded the remembered locale, so passing null here
  // renders in it — the <select> just has to catch up below.
  await loadLocale(null);

  const saved = await restoreSavedConnection();
  if (saved && saved.locale) $("#locale").value = saved.locale;

  const tool = await api().toolchain();

  // A partial translation still ships; the gaps are one diff away. Surface
  // them in the console rather than letting them be silent.
  const missing = await api().missing_keys();
  if (missing && missing.length) {
    console.warn("i18n: falling back to English for", missing.length, "key(s):", missing);
  }

  $("#locale").addEventListener("change", async (e) => {
    await loadLocale(e.target.value);
    // Re-render whatever is on screen so dynamic strings follow the switch.
    // The password placeholder is set from JS, not from a data-i18n
    // attribute, so applyStaticStrings() does not reach it.
    applySavedPasswordPlaceholder(Boolean($("#ssh-pass").placeholder));
    if (document.body.dataset.view === "preflight") await runPreflight();
  });

  const tabs = $$(".tab");
  for (const tab of tabs) {
    tab.addEventListener("click", () => transportTab(tab.dataset.transport));
    tab.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
      transportTab(next.dataset.transport, true);
    });
  }
  $("#rescan").addEventListener("click", refreshDevices);
  $("#ssh-connect").addEventListener("click", connectSsh);
  $("#ssh-pass").addEventListener("keydown", (e) => {
    if (e.key === "Enter") connectSsh();
  });
  $("#ssh-remember").addEventListener("change", async (e) => {
    // Un-ticking deletes the stored blob now, not at the next connect. A box
    // that says "forget it" and then keeps it until later is a lie.
    if (e.target.checked) return;
    await api().forget();
    applySavedPasswordPlaceholder(false);
  });
  $("#cancel").addEventListener("click", async (e) => {
    e.target.disabled = true; // one click; poll() reports the outcome
    await api().cancel();
  });
  $("#start").addEventListener("click", () => start("install"));
  $("#uninstall").addEventListener("click", () => start("uninstall"));
  $("#restart").addEventListener("click", () => {
    HOST = null;
    view("connect");
    refreshDevices();
  });

  if (tool.ok) await refreshDevices();
  else $("#no-device").hidden = false;
}

window.addEventListener("pywebviewready", boot);
