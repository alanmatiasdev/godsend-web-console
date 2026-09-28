package http

import (
	"encoding/json"
	stdhttp "net/http"
	"sort"

	"godsend/app"
)

func (d *Deps) handleWebUIRomSystems(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if r.Method != stdhttp.MethodGet {
		jsonError(w, stdhttp.StatusMethodNotAllowed, "GET required")
		return
	}
	type system struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	systems := make([]system, 0, len(app.ROMSystems))
	for id, item := range app.ROMSystems {
		systems = append(systems, system{ID: id, Name: item.Name})
	}
	sort.Slice(systems, func(i, j int) bool { return systems[i].Name < systems[j].Name })
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"systems": systems})
}
