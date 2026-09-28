package http

import (
	"context"
	"encoding/json"
	"net"
	"net/http/httptest"
	"testing"
)

func TestNormalizeArtworkType(t *testing.T) {
	for input, want := range map[string]string{
		"screenshot7": "screenshot", " Banner ": "banner", "ICON": "icon", "background": "background",
		"cover": "cover", "": "cover", "unknown": "cover",
	} {
		if got := normalizeArtworkType(input); got != want {
			t.Errorf("normalizeArtworkType(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestParseCatalogAssets(t *testing.T) {
	xml := `<live:image><live:fileUrl>http://x/icon.png</live:fileUrl><live:relationshipType>15</live:relationshipType></live:image>
<live:image><live:fileUrl>http://x/tile.png</live:fileUrl><live:relationshipType>23</live:relationshipType></live:image>
<live:image><live:fileUrl>http://x/bg.jpg</live:fileUrl><live:relationshipType>25</live:relationshipType></live:image>
<live:image><live:fileUrl>http://x/banner.jpg</live:fileUrl><live:relationshipType>27</live:relationshipType></live:image>
<live:image><live:fileUrl>http://x/other.jpg</live:fileUrl><live:relationshipType>99</live:relationshipType></live:image>
<live:image><live:relationshipType>25</live:relationshipType></live:image>
<live:slideShow><live:fileUrl>http://x/shot1.jpg</live:fileUrl></live:slideShow>`
	assets := parseCatalogAssets(xml)
	if len(assets.Icon) != 2 || len(assets.Background) != 1 || len(assets.Banner) != 1 || len(assets.Screenshot) != 1 {
		t.Fatalf("unexpected assets: %+v", assets)
	}
}

func TestParseXboxUnityAcceptsLooselyTypedPayload(t *testing.T) {
	body := []byte(`[
{"titleid":"4D5307E6","official":false,"front":"http://a/low","rating":"2"},
{"titleid":"4D5307E6","official":true,"front":"http://a/best","rating":"5"},
{"titleid":"4D5307E6","official":true,"front":"","thumbnail":"http://a/thumb","rating":3},
{"titleid":123,"official":"1","url":"http://a/url","rating":null},
{"titleid":"4D5307E6","front":"","thumbnail":"","url":""}]`)
	got := parseXboxUnity(body)
	if len(got) != 4 {
		t.Fatalf("want 4 usable results, got %d", len(got))
	}
	if got[0].url != "http://a/best" || got[1].url != "http://a/thumb" || got[len(got)-1].url != "http://a/low" {
		t.Fatalf("unexpected order: %+v", got)
	}
	if got[0].TitleID != "4D5307E6" || got[0].Rating == nil || *got[0].Rating != 5 {
		t.Fatalf("unexpected first result: %+v", got[0])
	}
	for _, item := range got {
		if item.url == "http://a/url" && (item.TitleID != "" || !item.Official || item.Rating != nil) {
			t.Fatalf("unexpected loosely typed result: %+v", item)
		}
	}
	if parseXboxUnity([]byte("not json")) != nil {
		t.Fatal("invalid JSON must yield no results")
	}
}

func TestIsPublicIP(t *testing.T) {
	for address, want := range map[string]bool{
		"8.8.8.8": true, "127.0.0.1": false, "10.77.15.115": false, "192.168.1.5": false,
		"169.254.1.1": false, "0.0.0.0": false, "::1": false, "fe80::1": false, "2606:4700::1111": true,
	} {
		if got := isPublicIP(net.ParseIP(address)); got != want {
			t.Errorf("isPublicIP(%s) = %v, want %v", address, got, want)
		}
	}
	if isPublicIP(nil) {
		t.Error("nil address must not be public")
	}
}

func TestArtworkClientRefusesPrivateAddresses(t *testing.T) {
	server := httptest.NewServer(nil)
	defer server.Close()
	if _, err := fetchArtworkBytes(context.Background(), server.URL, 1024); err == nil {
		t.Fatal("loopback server was reachable through the artwork client")
	}
	if _, err := fetchArtworkBytes(context.Background(), "file:///etc/passwd", 1024); err == nil {
		t.Fatal("non-HTTP URL was accepted")
	}
}

func TestArtworkSearchWithoutTermDoesNotFetch(t *testing.T) {
	mux := (&Deps{}).NewRouter()
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest("GET", "/webui/artwork/search?type=cover", nil))
	var body struct {
		OK      bool          `json:"ok"`
		Results []interface{} `json:"results"`
	}
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &body) != nil || !body.OK || body.Results == nil || len(body.Results) != 0 {
		t.Fatalf("status %d, body %q", response.Code, response.Body.String())
	}
	post := httptest.NewRecorder()
	mux.ServeHTTP(post, httptest.NewRequest("POST", "/webui/artwork/search", nil))
	if post.Code != 405 {
		t.Fatalf("POST status %d, want 405", post.Code)
	}
}
