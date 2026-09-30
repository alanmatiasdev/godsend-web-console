package http

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	"image/png"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const unityArchiveRoot = "https://raw.githubusercontent.com/UncreativeXenon/XboxUnity-Scraper/master/"

var unityArchiveID = regexp.MustCompile(`^[0-9A-Fa-f]{8}$`)
var unityArchiveCoverID = regexp.MustCompile(`^[0-9]+$`)

type unityArchiveTitle struct {
	TitleID   string `json:"TitleID"`
	HBTitleID string `json:"HBTitleID"`
	Name      string `json:"Name"`
	Covers    string `json:"Covers"`
}

type unityArchiveCover struct {
	CoverID  string `json:"CoverID"`
	Official string `json:"Official"`
	Rating   string `json:"Rating"`
}

var unityArchiveIndex struct {
	sync.Mutex
	titles  map[string]unityArchiveTitle
	expires time.Time
	retryAt time.Time
}

func loadUnityArchiveIndex(ctx context.Context) (map[string]unityArchiveTitle, error) {
	unityArchiveIndex.Lock()
	defer unityArchiveIndex.Unlock()
	if len(unityArchiveIndex.titles) > 0 && time.Now().Before(unityArchiveIndex.expires) {
		return unityArchiveIndex.titles, nil
	}
	if time.Now().Before(unityArchiveIndex.retryAt) {
		if len(unityArchiveIndex.titles) > 0 {
			return unityArchiveIndex.titles, nil
		}
		return nil, errors.New("archive temporarily unavailable")
	}
	data, err := fetchArtworkBytes(ctx, unityArchiveRoot+"metadata.json", 4<<20)
	if err != nil {
		unityArchiveIndex.retryAt = time.Now().Add(time.Minute)
		if len(unityArchiveIndex.titles) > 0 {
			return unityArchiveIndex.titles, nil
		}
		return nil, err
	}
	var payload struct {
		Items []unityArchiveTitle `json:"Items"`
	}
	if err := json.Unmarshal(data, &payload); err != nil || len(payload.Items) == 0 {
		unityArchiveIndex.retryAt = time.Now().Add(time.Minute)
		return nil, errors.New("invalid archive index")
	}
	titles := make(map[string]unityArchiveTitle, len(payload.Items)*2)
	for _, item := range payload.Items {
		id := strings.ToUpper(item.TitleID)
		if !unityArchiveID.MatchString(id) || strings.TrimSpace(item.Name) == "" {
			continue
		}
		titles[id] = item
		if hb := strings.ToUpper(item.HBTitleID); hb != "00000000" && unityArchiveID.MatchString(hb) {
			titles[hb] = item
		}
	}
	unityArchiveIndex.titles = titles
	unityArchiveIndex.expires = time.Now().Add(24 * time.Hour)
	unityArchiveIndex.retryAt = time.Time{}
	return titles, nil
}

func bestUnityArchiveCover(data []byte) string {
	var payload struct {
		Covers []unityArchiveCover `json:"Covers"`
	}
	if json.Unmarshal(data, &payload) != nil {
		return ""
	}
	sort.SliceStable(payload.Covers, func(i, j int) bool {
		a, b := payload.Covers[i], payload.Covers[j]
		if (a.Official == "1") != (b.Official == "1") {
			return a.Official == "1"
		}
		ar, _ := strconv.ParseFloat(a.Rating, 64)
		br, _ := strconv.ParseFloat(b.Rating, 64)
		return ar > br
	})
	for _, cover := range payload.Covers {
		if unityArchiveCoverID.MatchString(cover.CoverID) {
			return cover.CoverID
		}
	}
	return ""
}

// unityArchivePNG normalizes archive cover files for Aurora. Some files with a
// .png name are JPEG-encoded, which Aurora cannot safely import under a PNG
// filename.
func unityArchivePNG(data []byte) ([]byte, error) {
	switch imageMime(data) {
	case "image/png":
		return data, nil
	case "image/jpeg":
		decoded, _, err := image.Decode(bytes.NewReader(data))
		if err != nil {
			return nil, err
		}
		var encoded bytes.Buffer
		if err := png.Encode(&encoded, decoded); err != nil {
			return nil, err
		}
		return encoded.Bytes(), nil
	default:
		return nil, errors.New("unsupported image format")
	}
}

// The Aurora Lua HTTP client consumes small plain-text responses and saves PNGs
// into User/Import; it never downloads the full catalog or talks to GitHub.
func (d *Deps) handleWebUIUnityArchive(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	id := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("title_id")))
	if !unityArchiveID.MatchString(id) {
		http.Error(w, "invalid title_id", http.StatusBadRequest)
		return
	}
	path := r.URL.Path
	if path != "/webui/unity-archive/title" && path != "/webui/unity-archive/cover" && path != "/webui/unity-archive/icon" {
		http.NotFound(w, r)
		return
	}
	titles, err := loadUnityArchiveIndex(r.Context())
	if err != nil {
		http.Error(w, "archive unavailable", http.StatusBadGateway)
		return
	}
	title, ok := titles[id]
	if !ok {
		http.NotFound(w, r)
		return
	}
	if path == "/webui/unity-archive/title" {
		name := strings.Map(func(char rune) rune {
			if char == '\n' || char == '\r' || char < 32 {
				return -1
			}
			return char
		}, strings.TrimSpace(title.Name))
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=3600")
		fmt.Fprint(w, name)
		return
	}
	var imageURL string
	if path == "/webui/unity-archive/icon" {
		imageURL = unityArchiveRoot + "Icons/" + strings.ToUpper(title.TitleID) + ".png"
	} else {
		if title.Covers == "0" {
			http.NotFound(w, r)
			return
		}
		coverData, err := fetchArtworkBytes(r.Context(), unityArchiveRoot+"Covers/"+strings.ToUpper(title.TitleID)+"/metadata.json", 1<<20)
		if err != nil {
			http.Error(w, "cover list unavailable", http.StatusBadGateway)
			return
		}
		coverID := bestUnityArchiveCover(coverData)
		if coverID == "" {
			http.NotFound(w, r)
			return
		}
		imageURL = unityArchiveRoot + "Covers/" + strings.ToUpper(title.TitleID) + "/Large/" + coverID + ".png"
	}
	image, err := fetchArtworkBytes(r.Context(), imageURL, artworkMaxImageBytes)
	if err != nil {
		http.Error(w, "image unavailable", http.StatusBadGateway)
		return
	}
	image, err = unityArchivePNG(image)
	if err != nil {
		http.Error(w, "image unavailable", http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Write(image)
}
