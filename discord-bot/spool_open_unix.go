//go:build unix

package main

import (
	"os"
	"syscall"
)

// openSpoolEntry never follows a symlink and never blocks on a FIFO swapped into the spool.
func openSpoolEntry(path string) (*os.File, error) {
	return os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
}

// openLogAppend appends to the /tmp log as root without following a planted symlink.
func openLogAppend(path string) (*os.File, error) {
	return os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY|syscall.O_NOFOLLOW, 0644)
}

// spoolDirTrusted: a real directory (not a symlink) owned by root, mode 1777.
// In sticky /tmp only its owner can replace it, so it stays trusted once true.
func spoolDirTrusted() bool {
	fi, err := os.Lstat(spoolDir)
	if err != nil || !fi.IsDir() {
		return false
	}
	st, ok := fi.Sys().(*syscall.Stat_t)
	return ok && st.Uid == 0 && fi.Mode()&os.ModeSticky != 0 && fi.Mode().Perm() == 0o777
}

// chmodSpoolDir sets 1777 through an O_NOFOLLOW descriptor, so a raced-in symlink is never chmodded.
func chmodSpoolDir() error {
	f, err := os.OpenFile(spoolDir, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_DIRECTORY, 0)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Chmod(os.ModeSticky | 0o777)
}
