package http

import (
	stdhttp "net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

var webUIThumbnailCache struct {
	sync.Mutex
	items map[string]struct {
		image   []byte
		expires time.Time
	}
}

func (d *Deps) handleWebUIThumbnail(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if r.Method != stdhttp.MethodGet {
		jsonError(w, stdhttp.StatusMethodNotAllowed, "GET required")
		return
	}
	term := strings.TrimSpace(r.URL.Query().Get("query"))
	if term == "" || len(term) > 160 {
		jsonError(w, stdhttp.StatusBadRequest, "query required (160 bytes max)")
		return
	}
	key := strings.ToLower(term)
	webUIThumbnailCache.Lock()
	item, cached := webUIThumbnailCache.items[key]
	if cached && time.Now().After(item.expires) {
		delete(webUIThumbnailCache.items, key)
		cached = false
	}
	webUIThumbnailCache.Unlock()
	if cached {
		if len(item.image) == 0 {
			stdhttp.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", imageMime(item.image))
		w.Header().Set("Cache-Control", "public, max-age=3600")
		w.Write(item.image)
		return
	}
	results := searchXboxUnity(r.Context(), term)
	var image []byte
	for _, result := range results {
		if result.url == "" {
			continue
		}
		bytes, err := fetchArtworkBytes(r.Context(), result.url, artworkMaxImageBytes)
		if err == nil && imageMime(bytes) != "" {
			image = bytes
			break
		}
	}
	if len(image) == 0 && artworkTitleIDPattern.MatchString(term) {
		fallback := "http://catalog.xboxlive.com/Catalog/Product/CoverArt/" + url.PathEscape(strings.ToUpper(term)) + "/en-US/1"
		bytes, err := fetchArtworkBytes(r.Context(), fallback, artworkMaxImageBytes)
		if err == nil && imageMime(bytes) != "" {
			image = bytes
		}
	}
	webUIThumbnailCache.Lock()
	if webUIThumbnailCache.items == nil || len(webUIThumbnailCache.items) >= 200 {
		webUIThumbnailCache.items = make(map[string]struct {
			image   []byte
			expires time.Time
		})
	}
	webUIThumbnailCache.items[key] = struct {
		image   []byte
		expires time.Time
	}{image, time.Now().Add(time.Hour)}
	webUIThumbnailCache.Unlock()
	if len(image) == 0 {
		stdhttp.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", imageMime(image))
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Write(image)
}
