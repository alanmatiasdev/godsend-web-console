package http

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
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

func TestUnityArchivePNG(t *testing.T) {
	pngImage := image.NewRGBA(image.Rect(0, 0, 100, 100))
	pngImage.Set(0, 0, color.RGBA{B: 255, A: 255})
	var pngData bytes.Buffer
	if err := png.Encode(&pngData, pngImage); err != nil {
		t.Fatal(err)
	}
	got, err := unityArchivePNG(pngData.Bytes())
	if err != nil || !bytes.Equal(got, pngData.Bytes()) {
		t.Fatalf("PNG should be unchanged, got %q, %v", got, err)
	}

	jpegImage := image.NewRGBA(image.Rect(0, 0, 100, 100))
	jpegImage.Set(0, 0, color.RGBA{R: 255, A: 255})
	var jpegData bytes.Buffer
	if err := jpeg.Encode(&jpegData, jpegImage, nil); err != nil {
		t.Fatal(err)
	}
	got, err = unityArchivePNG(jpegData.Bytes())
	if err != nil || imageMime(got) != "image/png" {
		t.Fatalf("JPEG conversion = %q, %v", imageMime(got), err)
	}

	if _, err := unityArchivePNG([]byte("not an image")); err == nil {
		t.Fatal("invalid image was accepted")
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
