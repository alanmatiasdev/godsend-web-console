package http

import (
	"encoding/json"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	stdhttp "net/http"
)

// handleWebUIUpload streams browser-selected files to Xbox FTP without exposing
// a GODsend host filesystem path to the browser.
func (d *Deps) handleWebUIUpload(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if r.Method != stdhttp.MethodPost {
		jsonError(w, stdhttp.StatusMethodNotAllowed, "POST required")
		return
	}
	r.Body = stdhttp.MaxBytesReader(w, r.Body, 5<<30)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		jsonError(w, stdhttp.StatusBadRequest, "Invalid or oversized upload")
		return
	}
	ip := strings.TrimSpace(r.FormValue("ip"))
	remoteDir := strings.TrimSpace(r.FormValue("remote_path"))
	if ip == "" || remoteDir == "" {
		jsonError(w, stdhttp.StatusBadRequest, "ip and remote_path required")
		return
	}
	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		jsonError(w, stdhttp.StatusBadRequest, "files required")
		return
	}
	var relativePaths []string
	if raw := r.FormValue("paths"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &relativePaths); err != nil || len(relativePaths) != len(files) {
			jsonError(w, stdhttp.StatusBadRequest, "invalid relative paths")
			return
		}
	} else {
		relativePaths = make([]string, len(files))
		for i, header := range files {
			relativePaths[i] = header.Filename
		}
	}
	tempDir, err := os.MkdirTemp("", "godsend-webui-upload-")
	if err != nil {
		jsonError(w, stdhttp.StatusInternalServerError, err.Error())
		return
	}
	cleanupAfterRequest := true
	defer func() {
		if cleanupAfterRequest {
			_ = os.RemoveAll(tempDir)
		}
	}()
	filesRoot := filepath.Join(tempDir, "files")
	if err := os.MkdirAll(filesRoot, 0755); err != nil {
		jsonError(w, 500, err.Error())
		return
	}
	localPaths := make([]string, 0, len(files))
	seen := make(map[string]bool, len(files))
	directories := make(map[string]bool)
	for index, header := range files {
		relative := strings.ReplaceAll(relativePaths[index], "\\", "/")
		clean := path.Clean(relative)
		if relative == "" || strings.HasPrefix(clean, "/") || clean == ".." || strings.HasPrefix(clean, "../") || strings.ContainsRune(clean, 0) {
			jsonError(w, stdhttp.StatusBadRequest, "Invalid relative file path")
			return
		}
		parts := strings.Split(clean, "/")
		for _, part := range parts {
			if part == "" || part == "." || part == ".." || strings.Contains(part, ":") {
				jsonError(w, stdhttp.StatusBadRequest, "Invalid relative file path")
				return
			}
		}
		key := strings.ToLower(clean)
		if seen[key] {
			jsonError(w, stdhttp.StatusBadRequest, "Selected files contain duplicate paths")
			return
		}
		seen[key] = true
		source, err := header.Open()
		if err != nil {
			jsonError(w, stdhttp.StatusBadRequest, err.Error())
			return
		}
		target := filepath.Join(filesRoot, filepath.FromSlash(clean))
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			source.Close()
			jsonError(w, 500, err.Error())
			return
		}
		out, err := os.Create(target)
		if err != nil {
			source.Close()
			jsonError(w, stdhttp.StatusInternalServerError, err.Error())
			return
		}
		_, err = io.Copy(out, source)
		closeErr := out.Close()
		source.Close()
		if err != nil {
			jsonError(w, stdhttp.StatusInternalServerError, err.Error())
			return
		}
		if closeErr != nil {
			jsonError(w, stdhttp.StatusInternalServerError, closeErr.Error())
			return
		}
		rootName := parts[0]
		rootPath := filepath.Join(filesRoot, rootName)
		if len(parts) == 1 {
			localPaths = append(localPaths, target)
		} else if !directories[rootPath] {
			localPaths = append(localPaths, rootPath)
			directories[rootPath] = true
		}
	}
	jobs := d.FTPMgr.Upload(ip, localPaths, remoteDir)
	jobIDs := make(map[int64]bool, len(jobs))
	responseJobs := make([]map[string]interface{}, 0, len(jobs))
	for _, job := range jobs {
		jobIDs[job.ID] = true
		responseJobs = append(responseJobs, map[string]interface{}{"id": job.ID, "name": job.Name})
	}
	cleanupAfterRequest = false
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for range ticker.C {
			active := false
			for _, job := range d.FTPMgr.ListJobs() {
				if jobIDs[job.ID] && job.State != "Ready" && job.State != "Error" {
					active = true
					break
				}
			}
			if !active {
				_ = os.RemoveAll(tempDir)
				return
			}
		}
	}()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "jobs": responseJobs})
}
