package http

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	stdhttp "net/http"
)

const (
	artworkMaxImageBytes = 8 << 20
	artworkMaxResults    = 10
	artworkFetchLimit    = 4
)

var (
	artworkTitleIDPattern = regexp.MustCompile(`^[0-9A-Fa-f]{8}$`)
	artworkTrailingDigits = regexp.MustCompile(`\d+$`)
	artworkImageBlock     = regexp.MustCompile(`(?is)<live:image[^>]*>(.*?)</live:image>`)
	artworkSlideBlock     = regexp.MustCompile(`(?is)<live:slideShow[^>]*>(.*?)</live:slideShow>`)
	artworkFileURL        = regexp.MustCompile(`(?is)<live:fileUrl[^>]*>\s*(https?://[^\s<]+)\s*</live:fileUrl>`)
	artworkRelationship   = regexp.MustCompile(`(?is)<live:relationshipType[^>]*>\s*(\d+)\s*</live:relationshipType>`)
)

// artworkResult is one candidate image. Image is a data URL so the browser never
// has to reach the third-party hosts (plain HTTP, no CORS) itself.
type artworkResult struct {
	TitleID   string   `json:"titleId"`
	AssetType string   `json:"assetType"`
	Source    string   `json:"source"`
	Official  bool     `json:"official"`
	Rating    *float64 `json:"rating"`
	Image     string   `json:"image"`

	url string
}

type catalogAssets struct {
	Icon, Background, Banner, Screenshot []string
}

// handleWebUIArtworkSearch looks up Aurora artwork candidates on XboxUnity and
// the Xbox catalog, mirroring the desktop app's search.
//
// GET /webui/artwork/search?type=cover|background|banner|icon|screenshot&title_id=XXXXXXXX&query=text
func (d *Deps) handleWebUIArtworkSearch(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if r.Method != stdhttp.MethodGet {
		jsonError(w, stdhttp.StatusMethodNotAllowed, "GET required")
		return
	}
	values := r.URL.Query()
	assetType := normalizeArtworkType(values.Get("type"))
	titleID := strings.TrimSpace(values.Get("title_id"))
	query := strings.TrimSpace(values.Get("query"))
	term := query
	if artworkTitleIDPattern.MatchString(titleID) {
		term = strings.ToUpper(titleID)
	}
	results := []artworkResult{}
	if term != "" {
		results = searchArtwork(r.Context(), assetType, term, query)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "results": results})
}

func normalizeArtworkType(raw string) string {
	value := artworkTrailingDigits.ReplaceAllString(strings.ToLower(strings.TrimSpace(raw)), "")
	switch value {
	case "background", "banner", "icon", "screenshot":
		return value
	}
	return "cover"
}

func searchArtwork(ctx context.Context, assetType, term, fallbackQuery string) []artworkResult {
	if assetType == "cover" {
		found := searchXboxUnity(ctx, term)
		if len(found) == 0 && fallbackQuery != "" && fallbackQuery != term {
			found = searchXboxUnity(ctx, fallbackQuery)
		}
		if len(found) > 0 && artworkTitleIDPattern.MatchString(found[0].TitleID) {
			cdnURL := fmt.Sprintf("http://catalog.xboxlive.com/Catalog/Product/CoverArt/%s/en-US/1", found[0].TitleID)
			found = append([]artworkResult{{TitleID: found[0].TitleID, AssetType: "cover", Source: "xbox-cdn", Official: true, url: cdnURL}}, found...)
		}
		return fetchArtworkImages(ctx, found)
	}

	titleID := strings.ToUpper(term)
	if !artworkTitleIDPattern.MatchString(titleID) {
		titleID = ""
		for _, item := range searchXboxUnity(ctx, term) {
			if artworkTitleIDPattern.MatchString(item.TitleID) {
				titleID = item.TitleID
				break
			}
		}
	}
	if titleID == "" {
		return []artworkResult{}
	}
	xml, err := fetchArtworkBytes(ctx, catalogURL(titleID), 2<<20)
	if err != nil {
		return []artworkResult{}
	}
	assets := parseCatalogAssets(string(xml))
	urls := map[string][]string{"icon": assets.Icon, "background": assets.Background, "banner": assets.Banner, "screenshot": assets.Screenshot}[assetType]
	candidates := make([]artworkResult, 0, len(urls))
	for _, item := range urls {
		candidates = append(candidates, artworkResult{TitleID: titleID, AssetType: assetType, Source: "xbox-cdn", Official: true, url: item})
	}
	return fetchArtworkImages(ctx, candidates)
}

func searchXboxUnity(ctx context.Context, term string) []artworkResult {
	body, err := fetchArtworkBytes(ctx, "http://xboxunity.net/api/Covers/"+url.PathEscape(term), 2<<20)
	if err != nil {
		return nil
	}
	return parseXboxUnity(body)
}

// parseXboxUnity reads the XboxUnity cover list. The service is loosely typed
// (for example "rating" is the string "5"), so numbers and flags are decoded
// leniently instead of failing the whole list on one unexpected type.
func parseXboxUnity(body []byte) []artworkResult {
	var items []struct {
		TitleID   interface{} `json:"titleid"`
		Front     string      `json:"front"`
		Thumbnail string      `json:"thumbnail"`
		URL       string      `json:"url"`
		Official  interface{} `json:"official"`
		Rating    interface{} `json:"rating"`
	}
	if json.Unmarshal(body, &items) != nil {
		return nil
	}
	results := make([]artworkResult, 0, len(items))
	for _, item := range items {
		source := item.Front
		if source == "" {
			source = item.Thumbnail
		}
		if source == "" {
			source = item.URL
		}
		if source == "" {
			continue
		}
		official := false
		switch value := item.Official.(type) {
		case bool:
			official = value
		case float64:
			official = value != 0
		case string:
			official = value == "1" || strings.EqualFold(value, "true")
		}
		var rating *float64
		switch value := item.Rating.(type) {
		case float64:
			rating = &value
		case string:
			if parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64); err == nil {
				rating = &parsed
			}
		}
		id := ""
		if value, ok := item.TitleID.(string); ok && artworkTitleIDPattern.MatchString(strings.TrimSpace(value)) {
			id = strings.ToUpper(strings.TrimSpace(value))
		}
		results = append(results, artworkResult{TitleID: id, AssetType: "cover", Source: "xboxunity", Official: official, Rating: rating, url: source})
	}
	sort.SliceStable(results, func(i, j int) bool {
		if results[i].Official != results[j].Official {
			return results[i].Official
		}
		return ratingValue(results[i]) > ratingValue(results[j])
	})
	if len(results) > artworkMaxResults {
		results = results[:artworkMaxResults]
	}
	return results
}

func ratingValue(result artworkResult) float64 {
	if result.Rating == nil {
		return 0
	}
	return *result.Rating
}

func catalogURL(titleID string) string {
	return "http://catalog-cdn.xboxlive.com/Catalog/Catalog.asmx/Query" +
		"?methodName=FindGames&Names=Locale&Values=en-US&Names=LegalLocale&Values=en-US" +
		"&Names=Store&Values=1&Names=PageSize&Values=100&Names=PageNum&Values=1" +
		"&Names=DetailView&Values=5&Names=OfferFilterLevel&Values=1" +
		"&Names=MediaIds&Values=66acd000-77fe-1000-9115-d802" + titleID +
		"&Names=UserTypes&Values=2&Names=MediaTypes&Values=1&Names=MediaTypes&Values=21" +
		"&Names=MediaTypes&Values=23&Names=MediaTypes&Values=37&Names=MediaTypes&Values=46"
}

func parseCatalogAssets(xml string) catalogAssets {
	var assets catalogAssets
	for _, block := range artworkImageBlock.FindAllStringSubmatch(xml, -1) {
		match := artworkFileURL.FindStringSubmatch(block[1])
		if match == nil {
			continue
		}
		address := strings.TrimSpace(match[1])
		switch relationship := artworkRelationship.FindStringSubmatch(block[1]); {
		case relationship == nil:
		case relationship[1] == "15" || relationship[1] == "23":
			assets.Icon = append(assets.Icon, address)
		case relationship[1] == "25":
			assets.Background = append(assets.Background, address)
		case relationship[1] == "27":
			assets.Banner = append(assets.Banner, address)
		}
	}
	for _, block := range artworkSlideBlock.FindAllStringSubmatch(xml, -1) {
		if match := artworkFileURL.FindStringSubmatch(block[1]); match != nil {
			assets.Screenshot = append(assets.Screenshot, strings.TrimSpace(match[1]))
		}
	}
	return assets
}

// fetchArtworkImages downloads candidates concurrently, keeps their order, and
// drops anything that is not a PNG or JPEG (the only formats /rxea/encode reads).
func fetchArtworkImages(ctx context.Context, candidates []artworkResult) []artworkResult {
	if len(candidates) > artworkMaxResults+1 {
		candidates = candidates[:artworkMaxResults+1]
	}
	images := make([]string, len(candidates))
	var wg sync.WaitGroup
	slots := make(chan struct{}, artworkFetchLimit)
	for index := range candidates {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			data, err := fetchArtworkBytes(ctx, candidates[index].url, artworkMaxImageBytes)
			if err != nil {
				return
			}
			if mime := imageMime(data); mime != "" {
				images[index] = "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
			}
		}(index)
	}
	wg.Wait()
	results := make([]artworkResult, 0, len(candidates))
	for index, candidate := range candidates {
		if images[index] == "" {
			continue
		}
		candidate.Image = images[index]
		if candidate.AssetType == "" {
			candidate.AssetType = "cover"
		}
		results = append(results, candidate)
	}
	return results
}

func imageMime(data []byte) string {
	switch {
	case len(data) >= 100 && data[0] == 0xFF && data[1] == 0xD8:
		return "image/jpeg"
	case len(data) >= 100 && data[0] == 0x89 && data[1] == 'P' && data[2] == 'N' && data[3] == 'G':
		return "image/png"
	}
	return ""
}

// artworkClient reaches only public addresses. The check runs on the resolved
// address of every connection, so redirects and DNS answers from the remote
// services cannot point the GODsend host at its own network. Proxies are
// bypassed so the check always sees the real destination.
var artworkClient = &stdhttp.Client{
	Timeout: 12 * time.Second,
	Transport: &stdhttp.Transport{
		Proxy: nil,
		DialContext: (&net.Dialer{
			Timeout: 8 * time.Second,
			Control: func(_, address string, _ syscall.RawConn) error {
				host, _, err := net.SplitHostPort(address)
				if err != nil || !isPublicIP(net.ParseIP(host)) {
					return errors.New("blocked non-public address")
				}
				return nil
			},
		}).DialContext,
	},
	CheckRedirect: func(_ *stdhttp.Request, via []*stdhttp.Request) error {
		if len(via) > 3 {
			return errors.New("too many redirects")
		}
		return nil
	},
}

func isPublicIP(ip net.IP) bool {
	return ip != nil && !ip.IsLoopback() && !ip.IsPrivate() && !ip.IsUnspecified() &&
		!ip.IsLinkLocalUnicast() && !ip.IsLinkLocalMulticast() && !ip.IsMulticast()
}

func fetchArtworkBytes(ctx context.Context, address string, limit int64) ([]byte, error) {
	parsed, err := url.Parse(address)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, errors.New("unsupported URL")
	}
	request, err := stdhttp.NewRequestWithContext(ctx, stdhttp.MethodGet, address, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", "Aurora/0.7b GODsend")
	response, err := artworkClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != stdhttp.StatusOK {
		return nil, fmt.Errorf("status %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("response too large")
	}
	return data, nil
}
