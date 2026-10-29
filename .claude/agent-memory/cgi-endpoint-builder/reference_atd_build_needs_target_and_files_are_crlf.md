---
name: atd-build-needs-target-and-files-are-crlf
description: native/qmanager_atd builds armv7 only with an explicit --target (no default in .cargo/config), and its working-tree .rs files are CRLF while the index is LF
metadata:
  type: reference
---

- `cargo build --release` in `native/qmanager_atd` builds the HOST (x86_64) binary; the device binary needs `--target armv7-unknown-linux-musleabihf`. In WSL (`wsl -d Ubuntu`, run via PowerShell, with `$HOME/.cargo/bin` on PATH and `CARGO_TARGET_DIR=$HOME/qatd-target`) cargo picks 1.99.0 from `rust-toolchain.toml`. `cargo test --target x86_64-unknown-linux-gnu` is the host test run.
- Working-tree sources are CRLF (`core.autocrlf=true`, index is LF). `grep -c $'\r'` reports 0 on them (MSYS grep), but perl/python matching of multi-line strings fails. Normalise the files you edit with `sed -i 's/\r$//'`; git diff stays clean.
- Git Bash heredocs containing quotes can fail with "unexpected EOF"; Write the script to `.orchestra/scratch/` and run it by path. A python heredoc with simple quoting worked.
- Baseline before T7.1-R: `cargo test` = 289 pass + 1 known failure (`the_real_shell_validator...`, deleted in 9ed44181..d56af02d).
