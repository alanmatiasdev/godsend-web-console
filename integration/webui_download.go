package http

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"

	stdhttp "net/http"
)

// handleWebUIDownload sends one Xbox FTP file to the browser. The FTP manager
// writes to a temporary file because its download API takes a local path.
func (d *Deps) handleWebUIDownload(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if r.Method != stdhttp.MethodGet {
		jsonError(w, stdhttp.StatusMethodNotAllowed, "GET required")
		return
	}
	ip := strings.TrimSpace(r.URL.Query().Get("ip"))
	remotePath := strings.TrimSpace(r.URL.Query().Get("path"))
	name := path.Base(strings.ReplaceAll(remotePath, "\\", "/"))
	if ip == "" || !strings.HasPrefix(remotePath, "/") || name == "." || name == ".." || name == "/" {
		jsonError(w, stdhttp.StatusBadRequest, "ip and absolute file path required")
		return
	}
	tempDir, err := os.MkdirTemp("", "godsend-webui-download-")
	if err != nil {
		jsonError(w, stdhttp.StatusInternalServerError, err.Error())
		return
	}
	defer os.RemoveAll(tempDir)
	localPath := filepath.Join(tempDir, name)
	if err := d.FTPMgr.DownloadFile(ip, remotePath, localPath); err != nil {
		jsonError(w, stdhttp.StatusBadGateway, err.Error())
		return
	}
	file, err := os.Open(localPath)
	if err != nil {
		jsonError(w, stdhttp.StatusInternalServerError, err.Error())
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		jsonError(w, stdhttp.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name))
	w.Header().Set("Content-Type", "application/octet-stream")
	stdhttp.ServeContent(w, r, name, info.ModTime(), file)
}
