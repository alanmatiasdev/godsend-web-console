package http

import (
	"embed"
	"io/fs"
	stdhttp "net/http"
)

// The integration script copies the Vite output into webui before building Go.
//go:embed webui
var webUI embed.FS

func registerWebUI(mux *stdhttp.ServeMux) {
	assets, err := fs.Sub(webUI, "webui")
	if err != nil {
		panic(err)
	}
	mux.Handle("/ui/", stdhttp.StripPrefix("/ui/", stdhttp.FileServer(stdhttp.FS(assets))))
	mux.HandleFunc("/ui", func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		stdhttp.Redirect(w, r, "/ui/", stdhttp.StatusPermanentRedirect)
	})
	mux.HandleFunc("/", func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		if r.URL.Path != "/" {
			stdhttp.NotFound(w, r)
			return
		}
		stdhttp.Redirect(w, r, "/ui/", stdhttp.StatusTemporaryRedirect)
	})
}

// webCORS allows a separately hosted GODsend Web UI to use this backend.
// The backend has no cookie or browser credential authentication, so requests
// are intentionally handled without credentials.
func webCORS(w stdhttp.ResponseWriter, _ *stdhttp.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
}
