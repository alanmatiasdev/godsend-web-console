package http

import (
	"encoding/json"
	stdhttp "net/http"
	"path/filepath"
)

func (d *Deps) handleWebUIPaths(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if r.Method != stdhttp.MethodGet {
		jsonError(w, stdhttp.StatusMethodNotAllowed, "GET required")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"transfer_dir": d.App.TransferDir,
		"ready_dir": filepath.Join(d.App.ToolsDir, "Ready"),
	})
}
