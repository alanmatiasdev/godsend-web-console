package http

import (
	"encoding/json"
	stdhttp "net/http"
	"strconv"

	"godsend/app"
)

func (d *Deps) handleWebUILogs(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if r.Method != stdhttp.MethodGet {
		jsonError(w, stdhttp.StatusMethodNotAllowed, "GET required")
		return
	}
	var after uint64
	if raw := r.URL.Query().Get("after"); raw != "" {
		parsed, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			jsonError(w, stdhttp.StatusBadRequest, "invalid after cursor")
			return
		}
		after = parsed
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"logs": app.RecentWebUILogs(after)})
}
