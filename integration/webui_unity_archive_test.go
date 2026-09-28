package http

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestBestUnityArchiveCover(t *testing.T) {
	data := []byte(`{"Covers":[{"CoverID":"10","Official":"0","Rating":"5"},{"CoverID":"20","Official":"1","Rating":"2"},{"CoverID":"30","Official":"1","Rating":"4"}]}`)
	if got := bestUnityArchiveCover(data); got != "30" {
		t.Fatalf("best cover = %q, want 30", got)
	}
	if got := bestUnityArchiveCover([]byte(`{"Covers":[{"CoverID":"../bad","Official":"1"}]}`)); got != "" {
		t.Fatalf("unsafe cover ID accepted: %q", got)
	}
}

func TestUnityArchiveTitleHandler(t *testing.T) {
	unityArchiveIndex.Lock()
	oldTitles, oldExpires, oldRetry := unityArchiveIndex.titles, unityArchiveIndex.expires, unityArchiveIndex.retryAt
	unityArchiveIndex.titles = map[string]unityArchiveTitle{"53450812": {TitleID: "53450812", Name: "Sonic\nUnleashed"}}
	unityArchiveIndex.expires = time.Now().Add(time.Hour)
	unityArchiveIndex.retryAt = time.Time{}
	unityArchiveIndex.Unlock()
	defer func() {
		unityArchiveIndex.Lock()
		unityArchiveIndex.titles, unityArchiveIndex.expires, unityArchiveIndex.retryAt = oldTitles, oldExpires, oldRetry
		unityArchiveIndex.Unlock()
	}()
	mux := (&Deps{}).NewRouter()
	for _, test := range []struct {
		path   string
		status int
		body   string
	}{
		{"/webui/unity-archive/title?title_id=53450812", 200, "SonicUnleashed"},
		{"/webui/unity-archive/title?title_id=123", 400, ""},
		{"/webui/unity-archive/title?title_id=00000000", 404, ""},
	} {
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest("GET", test.path, nil))
		if response.Code != test.status || (test.body != "" && strings.TrimSpace(response.Body.String()) != test.body) {
			t.Errorf("%s: status %d, body %q", test.path, response.Code, response.Body.String())
		}
	}
}
