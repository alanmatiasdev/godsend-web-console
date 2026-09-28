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
