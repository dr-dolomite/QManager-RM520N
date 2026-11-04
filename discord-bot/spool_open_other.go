//go:build !unix

package main

import "os"

// Non-unix hosts only build the package for go vet/test.
func openSpoolEntry(path string) (*os.File, error) {
	return os.Open(path)
}

func openLogAppend(path string) (*os.File, error) {
	return os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
}

func spoolDirTrusted() bool {
	fi, err := os.Lstat(spoolDir)
	return err == nil && fi.IsDir()
}

func chmodSpoolDir() error { return nil }
