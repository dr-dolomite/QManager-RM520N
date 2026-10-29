# Bundled Binaries (`dependencies/`)

Prebuilt executables shipped verbatim onto the modem by `build.sh` →
`install_rm520n.sh` (installed to `/usr/bin/`, mode 755). They are cross-compiled
out-of-band, not by this repo's build. This file records what they are and how to
reproduce them.

> The binaries here are committed directly to git (not gitignored, no LFS).

Target device: **Quectel RM520N-GL** — vanilla Linux (SDXLEMUR SoC, ARMv7
Cortex-A7, kernel 5.4.210), ARM **EABI5**, AT pipe on the char device
**`/dev/smd11`** (not a UART/TTY).

| Binary | Source | Notes |
|--------|--------|-------|
| `qmanager_atd` | internal (`native/`) | AT/SMS/QMI broker daemon; `/usr/bin/qcmd` and `/usr/bin/qsms` are symlinks to it. Static musl armhf build |


`sms_tool` (patched `obsy/sms_tool`) and `atcli_smd11` shipped here until T5.1 S6; `qsms` and `qcmd` replace them.
