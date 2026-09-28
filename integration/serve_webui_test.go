package http

import (
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

func TestEmbeddedWebUI(t *testing.T) {
	mux := (&Deps{}).NewRouter()

	index := httptest.NewRecorder()
	mux.ServeHTTP(index, httptest.NewRequest("GET", "/ui/", nil))
	if index.Code != 200 || !strings.Contains(index.Body.String(), "GODsend Web") {
		t.Fatalf("GET /ui/: status %d, body %q", index.Code, index.Body.String())
	}
	asset := regexp.MustCompile(`/ui/assets/[^" ]+\.js`).FindString(index.Body.String())
	if asset == "" {
		t.Fatal("index does not reference an embedded JavaScript asset")
	}
	js := httptest.NewRecorder()
	mux.ServeHTTP(js, httptest.NewRequest("GET", asset, nil))
	if js.Code != 200 || js.Body.Len() == 0 {
		t.Fatalf("GET %s: status %d, size %d", asset, js.Code, js.Body.Len())
	}

	root := httptest.NewRecorder()
	mux.ServeHTTP(root, httptest.NewRequest("GET", "/", nil))
	if root.Code != 307 || root.Header().Get("Location") != "/ui/" {
		t.Fatalf("GET /: status %d, location %q", root.Code, root.Header().Get("Location"))
	}
}
