// lib/config-backup/sections.ts — picker metadata and the mutex rule.
// Picker order, not apply order: the worker owns that (CFG_BACKUP_APPLY_ORDER).
import type {
  BackupSectionGroup,
  BackupSectionKey,
  BackupSectionMeta,
} from "@/types/config-backup";

export const BACKUP_GROUPS: BackupSectionGroup[] = [
  "connection",
  "local_network",
  "monitoring",
  "system",
];

export const BACKUP_SECTIONS: BackupSectionMeta[] = [
  { key: "network_mode", group: "connection", defaultChecked: true, needsReboot: false },
  { key: "bands", group: "connection", defaultChecked: true, needsReboot: false },
  { key: "apn", group: "connection", defaultChecked: true, needsReboot: false },
  { key: "tower_lock", group: "connection", defaultChecked: false, needsReboot: false },
  { key: "ttl_mtu", group: "connection", defaultChecked: true, needsReboot: false },
  { key: "imei", group: "connection", defaultChecked: false, needsReboot: true },
  { key: "profiles", group: "connection", defaultChecked: false, needsReboot: true },
  { key: "scenarios", group: "connection", defaultChecked: false, needsReboot: false },
  { key: "ip_passthrough", group: "connection", defaultChecked: true, needsReboot: true },
  { key: "sms", group: "connection", defaultChecked: true, needsReboot: false },
  { key: "lan", group: "local_network", defaultChecked: false, needsReboot: true },
  { key: "custom_dns", group: "local_network", defaultChecked: true, needsReboot: false },
  { key: "ethernet", group: "local_network", defaultChecked: true, needsReboot: false },
  { key: "traffic_engine", group: "local_network", defaultChecked: true, needsReboot: false },
  { key: "watchdog", group: "monitoring", defaultChecked: true, needsReboot: false },
  { key: "quality", group: "monitoring", defaultChecked: true, needsReboot: false },
  { key: "sites", group: "monitoring", defaultChecked: true, needsReboot: false },
  { key: "alerts", group: "monitoring", defaultChecked: true, needsReboot: false },
  { key: "adaptive_polling", group: "monitoring", defaultChecked: true, needsReboot: false },
  { key: "system", group: "system", defaultChecked: true, needsReboot: false },
];

export const SECTION_KEYS: BackupSectionKey[] = BACKUP_SECTIONS.map((s) => s.key);

const SECTION_BY_KEY = new Map(BACKUP_SECTIONS.map((s) => [s.key, s]));

export function sectionMeta(key: string): BackupSectionMeta | undefined {
  return SECTION_BY_KEY.get(key as BackupSectionKey);
}

export function isSectionKey(key: string): key is BackupSectionKey {
  return SECTION_BY_KEY.has(key as BackupSectionKey);
}

/** Two mutex groups: the parent owns its members, so both cannot travel together. */
export const MUTEX_GROUPS: { parent: BackupSectionKey; members: BackupSectionKey[] }[] = [
  { parent: "scenarios", members: ["network_mode", "bands"] },
  { parent: "profiles", members: ["apn", "ttl_mtu", "imei"] },
];

export type SelectionMap = Partial<Record<BackupSectionKey, boolean>>;

/** Why a row is held: the parent blocks members, or a member blocks the parent. */
export type MutexReason = { kind: "parent_on"; parent: BackupSectionKey } | { kind: "member_on"; parent: BackupSectionKey };

/**
 * Rows the mutex rule disables, with the reason. Checked + disabled is treated
 * as unchecked by the caller; the selection itself is never mutated.
 */
export function computeMutex(selection: SelectionMap): Map<BackupSectionKey, MutexReason> {
  const held = new Map<BackupSectionKey, MutexReason>();
  for (const g of MUTEX_GROUPS) {
    if (selection[g.parent]) {
      for (const m of g.members) held.set(m, { kind: "parent_on", parent: g.parent });
    } else if (g.members.some((m) => selection[m])) {
      held.set(g.parent, { kind: "member_on", parent: g.parent });
    }
  }
  return held;
}

/** Selected keys in picker order, minus anything the mutex holds or `allowed` excludes. */
export function effectiveKeys(
  selection: SelectionMap,
  allowed?: ReadonlySet<string> | null,
): BackupSectionKey[] {
  const held = computeMutex(selection);
  return SECTION_KEYS.filter(
    (k) => selection[k] && !held.has(k) && (!allowed || allowed.has(k)),
  );
}

export function initialSelection(): SelectionMap {
  const sel: SelectionMap = {};
  for (const s of BACKUP_SECTIONS) sel[s.key] = s.defaultChecked;
  return sel;
}

/** Restore defaults: every section in the backup, except IMEI and LAN. */
export function restoreSelection(keys: readonly BackupSectionKey[]): SelectionMap {
  const sel: SelectionMap = {};
  for (const k of keys) sel[k] = k !== "imei" && k !== "lan";
  // A backup cannot carry both sides of a mutex, but a hand-edited one could.
  for (const g of MUTEX_GROUPS) {
    if (sel[g.parent] && g.members.some((m) => sel[m])) sel[g.parent] = false;
  }
  return sel;
}
