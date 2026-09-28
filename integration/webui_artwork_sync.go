package http

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net"
	stdhttp "net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"godsend/app"
)

type webUIArtworkConfig struct {
	Enabled    bool   `json:"enabled"`
	XboxIP     string `json:"xbox_ip"`
	AuroraRoot string `json:"aurora_root"`
}

type webUIArtworkTitle struct {
	TitleID string `json:"title_id"`
	Name    string `json:"name"`
}

var webUIArtworkWork = make(chan struct{}, 1)

func validWebUIAuroraRoot(root string) bool {
	if !strings.HasPrefix(root, "/") || strings.ContainsAny(root, "\\\x00\r\n") || root == "/" {
		return false
	}
	for _, part := range strings.Split(root, "/") {
		if part == "." || part == ".." {
			return false
		}
	}
	return true
}

func (d *Deps) artworkConfigPath() string { return filepath.Join(d.App.ToolsDir, "webui-artwork.json") }

func (d *Deps) readArtworkConfig() webUIArtworkConfig {
	data, err := os.ReadFile(d.artworkConfigPath())
	if err != nil {
		return webUIArtworkConfig{}
	}
	var config webUIArtworkConfig
	if json.Unmarshal(data, &config) != nil {
		return webUIArtworkConfig{}
	}
	return config
}

func (d *Deps) handleWebUIArtworkConfig(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if r.Method == stdhttp.MethodGet {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(d.readArtworkConfig())
		return
	}
	if r.Method != stdhttp.MethodPost {
		jsonError(w, stdhttp.StatusMethodNotAllowed, "GET or POST required")
		return
	}
	var config webUIArtworkConfig
	if err := json.NewDecoder(stdhttp.MaxBytesReader(w, r.Body, 4096)).Decode(&config); err != nil || net.ParseIP(config.XboxIP) == nil || !validWebUIAuroraRoot(config.AuroraRoot) {
		jsonError(w, stdhttp.StatusBadRequest, "valid xbox_ip and absolute aurora_root required")
		return
	}
	data, _ := json.Marshal(config)
	if err := os.MkdirAll(d.App.ToolsDir, 0755); err != nil {
		jsonError(w, 500, err.Error())
		return
	}
	temp, err := os.CreateTemp(d.App.ToolsDir, ".webui-artwork-*")
	if err != nil {
		jsonError(w, 500, err.Error())
		return
	}
	defer os.Remove(temp.Name())
	if _, err = temp.Write(data); err == nil {
		err = temp.Close()
	} else {
		temp.Close()
	}
	if err == nil {
		err = os.Rename(temp.Name(), d.artworkConfigPath())
	}
	if err != nil {
		jsonError(w, 500, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(config)
}

func (d *Deps) installWebUIHooks() {
	app.SetWebUIFTPCompleteHook(func(gameName, titleID, xboxIP string) {
		config := d.readArtworkConfig()
		if !config.Enabled || !strings.EqualFold(config.XboxIP, xboxIP) || !artworkTitleIDPattern.MatchString(titleID) {
			return
		}
		go d.syncArtworkTitles(config.XboxIP, config.AuroraRoot, []webUIArtworkTitle{{TitleID: titleID, Name: gameName}})
	})
}

func (d *Deps) handleWebUIArtworkSync(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if r.Method != stdhttp.MethodPost {
		jsonError(w, stdhttp.StatusMethodNotAllowed, "POST required")
		return
	}
	var req struct {
		XboxIP     string              `json:"xbox_ip"`
		AuroraRoot string              `json:"aurora_root"`
		Titles     []webUIArtworkTitle `json:"titles"`
	}
	if err := json.NewDecoder(stdhttp.MaxBytesReader(w, r.Body, 64*1024)).Decode(&req); err != nil || net.ParseIP(req.XboxIP) == nil || !validWebUIAuroraRoot(req.AuroraRoot) || len(req.Titles) == 0 || len(req.Titles) > 200 {
		jsonError(w, stdhttp.StatusBadRequest, "valid xbox_ip, aurora_root and 1-200 titles required")
		return
	}
	for _, title := range req.Titles {
		if !artworkTitleIDPattern.MatchString(title.TitleID) {
			jsonError(w, stdhttp.StatusBadRequest, "invalid title ID")
			return
		}
	}
	go d.syncArtworkTitles(req.XboxIP, req.AuroraRoot, req.Titles)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(stdhttp.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]interface{}{"queued": len(req.Titles)})
}

func (d *Deps) syncArtworkTitles(ip, root string, titles []webUIArtworkTitle) {
	webUIArtworkWork <- struct{}{}
	defer func() { <-webUIArtworkWork }()
	for _, title := range titles {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		d.syncArtworkTitle(ctx, ip, root, title)
		cancel()
	}
}

func (d *Deps) syncArtworkTitle(ctx context.Context, ip, root string, title webUIArtworkTitle) {
	id := strings.ToUpper(title.TitleID)
	importDir := path.Join(root, "User/Import", id)
	if err := d.FTPMgr.Mkdir(ip, importDir); err != nil {
		d.App.Logf("[WARN] Auto-artwork %s: import folder: %v", id, err)
		return
	}
	count := 0
	for _, assetType := range []string{"cover", "background", "banner", "icon"} {
		if ctx.Err() != nil {
			break
		}
		results := searchArtwork(ctx, assetType, id, title.Name)
		if len(results) == 0 {
			continue
		}
		image := results[0].Image
		comma := strings.IndexByte(image, ',')
		if comma < 0 || !strings.HasSuffix(image[:comma], ";base64") {
			continue
		}
		content, err := base64.StdEncoding.DecodeString(image[comma+1:])
		if err != nil || len(content) < 100 || len(content) > artworkMaxImageBytes {
			continue
		}
		ext := ".png"
		if strings.HasPrefix(image, "data:image/jpeg;") {
			ext = ".jpg"
		}
		temp, err := os.CreateTemp("", "godsend-artwork-*")
		if err != nil {
			d.App.Logf("[WARN] Auto-artwork %s: %v", id, err)
			continue
		}
		_, writeErr := temp.Write(content)
		closeErr := temp.Close()
		if writeErr == nil {
			writeErr = closeErr
		}
		if writeErr == nil {
			writeErr = d.FTPMgr.UploadSingleFile(ip, temp.Name(), path.Join(importDir, assetType+ext))
		}
		os.Remove(temp.Name())
		if writeErr != nil {
			d.App.Logf("[WARN] Auto-artwork %s/%s: %v", id, assetType, writeErr)
			continue
		}
		count++
	}
	d.App.Logf("[INFO] Auto-artwork %s: uploaded %d assets to Aurora Import", id, count)
}
