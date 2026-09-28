package http

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	stdhttp "net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

const webUIArchiveMaxEntries = 10000
const webUIArchiveMaxDepth = 32

func validArchivePath(value string) bool {
	if !strings.HasPrefix(value, "/") || strings.Contains(value, "\\") || strings.ContainsRune(value, 0) {
		return false
	}
	for _, part := range strings.Split(value, "/") {
		if part == "." || part == ".." {
			return false
		}
	}
	return true
}

func validArchiveName(value string) bool {
	return value != "" && value != "." && value != ".." && !strings.ContainsAny(value, "/\\\x00")
}

// handleWebUIArchive packages selected Xbox files and folders for one browser download.
func (d *Deps) handleWebUIArchive(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if r.Method != stdhttp.MethodPost {
		jsonError(w, stdhttp.StatusMethodNotAllowed, "POST required")
		return
	}
	var req struct {
		IP    string   `json:"ip"`
		Paths []string `json:"paths"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&req); err != nil || strings.TrimSpace(req.IP) == "" || len(req.Paths) == 0 || len(req.Paths) > 100 {
		jsonError(w, stdhttp.StatusBadRequest, "ip and 1-100 paths required")
		return
	}
	for _, selected := range req.Paths {
		if !validArchivePath(selected) || selected == "/" || !validArchiveName(path.Base(selected)) {
			jsonError(w, stdhttp.StatusBadRequest, "invalid archive path")
			return
		}
	}
	tempDir, err := os.MkdirTemp("", "godsend-webui-archive-")
	if err != nil {
		jsonError(w, stdhttp.StatusInternalServerError, err.Error())
		return
	}
	defer os.RemoveAll(tempDir)
	archiveFile, err := os.Create(filepath.Join(tempDir, "Xbox-files.zip"))
	if err != nil {
		jsonError(w, stdhttp.StatusInternalServerError, err.Error())
		return
	}
	archive := zip.NewWriter(archiveFile)
	count := 0
	var addFile func(remotePath, archivePath string) error
	addFile = func(remotePath, archivePath string) error {
		if count >= webUIArchiveMaxEntries {
			return fmt.Errorf("archive exceeds %d entries", webUIArchiveMaxEntries)
		}
		localPath := filepath.Join(tempDir, "payload")
		if err := d.FTPMgr.DownloadFile(req.IP, remotePath, localPath); err != nil {
			return err
		}
		defer os.Remove(localPath)
		file, err := os.Open(localPath)
		if err != nil {
			return err
		}
		defer file.Close()
		entry, err := archive.Create(archivePath)
		if err != nil {
			return err
		}
		if _, err := io.Copy(entry, file); err != nil {
			return err
		}
		count++
		return nil
	}
	var add func(remotePath, archivePath string, depth int) error
	add = func(remotePath, archivePath string, depth int) error {
		if err := r.Context().Err(); err != nil {
			return err
		}
		if depth > webUIArchiveMaxDepth || count >= webUIArchiveMaxEntries {
			return fmt.Errorf("archive exceeds %d entries or %d folder levels", webUIArchiveMaxEntries, webUIArchiveMaxDepth)
		}
		entries, listErr := d.FTPMgr.List(req.IP, remotePath)
		if listErr == nil {
			count++
			if _, err := archive.Create(archivePath + "/"); err != nil {
				return err
			}
			for _, entry := range entries {
				if !validArchiveName(entry.Name) {
					return fmt.Errorf("invalid FTP entry name in %s", remotePath)
				}
				childRemote := path.Join(remotePath, entry.Name)
				childArchive := path.Join(archivePath, entry.Name)
				if entry.Type == "dir" {
					if err := add(childRemote, childArchive, depth+1); err != nil {
						return err
					}
				} else if entry.Type == "file" {
					if err := addFile(childRemote, childArchive); err != nil {
						return err
					}
				}
			}
			return nil
		}
		return addFile(remotePath, archivePath)
	}
	for _, selected := range req.Paths {
		if err := add(selected, path.Base(selected), 0); err != nil {
			archive.Close()
			archiveFile.Close()
			jsonError(w, stdhttp.StatusBadGateway, err.Error())
			return
		}
	}
	if err := archive.Close(); err != nil {
		archiveFile.Close()
		jsonError(w, stdhttp.StatusInternalServerError, err.Error())
		return
	}
	if _, err := archiveFile.Seek(0, io.SeekStart); err != nil {
		archiveFile.Close()
		jsonError(w, stdhttp.StatusInternalServerError, err.Error())
		return
	}
	info, err := archiveFile.Stat()
	if err != nil {
		archiveFile.Close()
		jsonError(w, stdhttp.StatusInternalServerError, err.Error())
		return
	}
	defer archiveFile.Close()
	w.Header().Set("Content-Disposition", `attachment; filename="Xbox-files.zip"`)
	w.Header().Set("Content-Type", "application/zip")
	stdhttp.ServeContent(w, r, "Xbox-files.zip", info.ModTime(), archiveFile)
}
