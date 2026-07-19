# Bundled Binaries (`dependencies/`)

Prebuilt executables shipped verbatim onto the modem by `build.sh` →
`install_rm520n.sh` (installed to `/usr/bin/`, mode 755). They are cross-compiled
out-of-band, not by this repo's build. This file records what they are and how to
reproduce them.

> The binaries here are committed directly to git (not gitignored, no LFS).
> When you rebuild `sms_tool`, commit the new binary together with an updated
> `sms_tool.patch`, this README, and `NOTICE` so they stay in sync.

Target device: **Quectel RM520N-GL** — vanilla Linux (SDXLEMUR SoC, ARMv7
Cortex-A7, kernel 5.4.210), ARM **EABI5**, AT pipe on the char device
**`/dev/smd11`** (not a UART/TTY).

| Binary | Source | Notes |
|--------|--------|-------|
| `sms_tool` | [`obsy/sms_tool`](https://github.com/obsy/sms_tool) (Apache-2.0) | Patched — see below. Same build shared with the RM551E sibling project. |
| `atcli_smd11` | internal | AT-command client bound to `/dev/smd11` |

---

## `sms_tool`

Patched fork of `obsy/sms_tool`. **This is the identical binary used by the
RM551E sibling project** (`sha256 eecb50b3335e16ca4ec25479b30d2a0bdf07ff2fccfe566bf232190301926edc`),
reused here after verifying on a live RM520N-GL that it runs cleanly — see
"ABI note" below. The patch (`dependencies/sms_tool.patch`, applied to
`sms_main.c`) makes four changes:

1. **Default device `/dev/ttyUSB0` → `/dev/smd11`.** Upstream's default does
   not exist on this modem (bare `sms_tool recv` used to crash). `/dev/smd11`
   is the AT device RM520N-GL actually uses.
2. **Skip `termios` on non-TTY devices** — `if (!isatty(port)) return;` in
   `setserial()`. `/dev/smd11` is an SMD char device, not a serial line, so
   `tcgetattr`/`tcsetattr` return `ENOTTY` ("Inappropriate ioctl for device").
   Guarding on `isatty()` removes that noise at the source.
3. **Guard the exit-time `termios` restore** (`resetserial()`) the same way, so
   no `failed tcsetattr: Inappropriate ioctl` is printed on exit.
4. **Fail loud, not fatal** on a missing port. Upstream printed "open port
   failed" then fell through to `fdopen(-1,…)` → `setvbuf(NULL,…)` → **SIGSEGV**.
   Each open/reopen/fdopen failure now `exit(1)`s cleanly. The verbose
   `open()`/`reopen()` traces are gated behind the existing `-D` debug flag.

Behavior is otherwise unchanged: `-d` overrides the default; `send`/`recv`/
`delete`/`status`/`ussd`/`at`, `-j` JSON, `-s ME|SM` storage selector, and `-D`
debug all work as before.

Because this build defaults to `/dev/smd11` and stays silent on the SMD char
device, the CGI callers no longer need the `-d /dev/smd11` flag or the
`2>/dev/null` termios-noise suppression that the previous (unpatched, soft-float)
binary required. `cellular/sms.sh` and `qmanager_health_check` were simplified
accordingly.

### ABI note — hard-float on RM520N-GL

This binary is **hard-float (armhf)**: ELF `e_flags 0x05000400`, EABI5, statically
linked. RM520N-GL's Cortex-A7 exposes `vfp vfpv3 vfpv4 neon vfpd32`
(`/proc/cpuinfo` Features), so the VFP instructions a hard-float build emits run
natively — **verified on a live device**: identical `recv -j` JSON to the
previously bundled soft-float binary, exit 0, zero stderr, no `SIGILL`. The older
soft-float bundling (`e_flags 0x05000200`) was a conservative default, not a
hardware requirement.

### Rebuild (static armhf)

Statically linked so it carries its own libc and runs regardless of the device's
libc version. `sms_tool` does no DNS/NSS (the one area where static glibc
misbehaves), so the simplest toolchain works:

```sh
# Toolchain: Ubuntu's armhf glibc cross-compiler (apt, reliable).
sudo apt install -y gcc-arm-linux-gnueabihf

git clone https://github.com/obsy/sms_tool.git
cd sms_tool
patch -p1 < /path/to/dependencies/sms_tool.patch     # patches sms_main.c

make CC=arm-linux-gnueabihf-gcc \
     CROSS_COMPILE=arm-linux-gnueabihf- \
     CFLAGS="-O2 -static"
arm-linux-gnueabihf-strip --strip-all sms_tool       # ~440 KB stripped

# MUST be static — verify (no INTERP segment):
arm-linux-gnueabihf-readelf -l sms_tool | grep -i INTERP   # -> (nothing)
file sms_tool   # ELF 32-bit LSB executable, ARM, EABI5, statically linked
```

`-static` can silently fall back to dynamic if a static lib is missing — always
run the `readelf -l … | grep INTERP` check and confirm it prints nothing.

### On-device smoke test

```sh
sms_tool status                      # defaults to smd11, silent, exit 0
sms_tool recv -j                     # no tcgetattr/tcsetattr noise, valid JSON
sms_tool recv -d /dev/ttyUSB0        # "open port failed", exit 1, NO segfault
sms_tool -D recv -d /dev/ttyUSB0     # open() trace reappears under -D
```
