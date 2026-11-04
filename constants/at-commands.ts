/**
 * The functional groups the built-in presets fall into. The popover renders one
 * section per member, in this order.
 */
export const AT_COMMAND_CATEGORIES = [
  "modem",
  "network",
  "sim",
  "apn",
  "bands",
  "passthrough",
] as const;

export type ATCommandCategory = (typeof AT_COMMAND_CATEGORIES)[number];

/** A user-defined preset. Its label is whatever the user typed, so it is not
 *  translatable and travels with the entry. */
export interface ATCommandPreset {
  label: string;
  command: string;
}

/** A built-in preset. Its label lives in the locale pack under
 *  `at_terminal.commands.presets.<id>`, so it is not carried here. */
export interface ATCommandDefault {
  id: string;
  command: string;
  category: ATCommandCategory;
}

/**
 * Default AT command presets loaded from the original `/etc/config/atcommands.user`.
 * Covers modem control (CFUN), network mode (QNWPREFCFG), SIM slots (QUIMSLOT),
 * APN management (CGDCONT), band queries, and IP passthrough (QMAP).
 */
export const DEFAULT_AT_COMMANDS: ATCommandDefault[] = [
  { id: "reboot", command: "AT+CFUN=1,1", category: "modem" },
  { id: "disconnect", command: "AT+CFUN=0", category: "modem" },
  { id: "connect", command: "AT+CFUN=1", category: "modem" },
  { id: "signal_info", command: 'AT+QENG="servingcell"', category: "modem" },
  { id: "ca_info", command: "AT+QCAINFO", category: "modem" },
  { id: "imei_show", command: "AT+EGMR=0,7", category: "modem" },
  { id: "mode_show", command: 'AT+QNWPREFCFG="mode_pref"', category: "network" },
  {
    id: "mode_auto",
    command: 'AT+QNWPREFCFG="mode_pref",AUTO',
    category: "network",
  },
  {
    id: "mode_nr_lte",
    command: 'AT+QNWPREFCFG="mode_pref",NR5G:LTE',
    category: "network",
  },
  {
    id: "mode_nr",
    command: 'AT+QNWPREFCFG="mode_pref",NR5G',
    category: "network",
  },
  {
    id: "mode_lte",
    command: 'AT+QNWPREFCFG="mode_pref",LTE',
    category: "network",
  },
  {
    id: "nr5g_disable_status",
    command: 'AT+QNWPREFCFG="nr5g_disable_mode"',
    category: "network",
  },
  {
    id: "nr5g_enable_both",
    command: 'AT+QNWPREFCFG="nr5g_disable_mode",0',
    category: "network",
  },
  {
    id: "nr5g_disable_sa",
    command: 'AT+QNWPREFCFG="nr5g_disable_mode",1',
    category: "network",
  },
  {
    id: "nr5g_disable_nsa",
    command: 'AT+QNWPREFCFG="nr5g_disable_mode",2',
    category: "network",
  },
  { id: "sim_slot_get", command: "AT+QUIMSLOT?", category: "sim" },
  { id: "sim_slot_1", command: "AT+QUIMSLOT=1", category: "sim" },
  { id: "sim_slot_2", command: "AT+QUIMSLOT=2", category: "sim" },
  { id: "apn_list", command: "AT+CGDCONT?", category: "apn" },
  {
    id: "apn_nrbroadband",
    command: 'AT+CGDCONT=1,"IPV4V6","NRBROADBAND"',
    category: "apn",
  },
  {
    id: "bands_nr_sa",
    command: 'AT+QNWPREFCFG="nr5g_band"',
    category: "bands",
  },
  {
    id: "bands_nr_nsa",
    command: 'AT+QNWPREFCFG="nsa_nr5g_band"',
    category: "bands",
  },
  { id: "bands_lte", command: 'AT+QNWPREFCFG="lte_band"', category: "bands" },
  {
    id: "ippt_addresses",
    command: 'AT+QMAP="WWAN"',
    category: "passthrough",
  },
  {
    id: "ippt_enable",
    command: 'AT+QMAP="MPDN_rule",0,1,0,1,1,"FF:FF:FF:FF:FF:FF"',
    category: "passthrough",
  },
  {
    id: "ippt_disable",
    command: 'AT+QMAP="MPDN_rule",0',
    category: "passthrough",
  },
];
