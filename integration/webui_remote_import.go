package http

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	stdhttp "net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const remoteImportMaxBytes int64 = isoUploadMaxBytes

var remoteImportsInProgress sync.Map

type remoteImportRequest struct {
	URL string `json:"url"`
}

// remoteImportURL accepts only direct web downloads. Credentials and local
// network destinations are refused so this unauthenticated endpoint cannot be
// used to read services that are private to the GODsend host.
func remoteImportURL(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u == nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil {
		return nil, errors.New("a direct HTTP(S) URL without credentials is required")
	}
	if ip := net.ParseIP(u.Hostname()); ip != nil && !publicRemoteIP(ip) {
		return nil, errors.New("local and private network addresses are not allowed")
	}
	return u, nil
}

func publicRemoteIP(ip net.IP) bool {
	return ip != nil && !ip.IsLoopback() && !ip.IsPrivate() && !ip.IsLinkLocalUnicast() && !ip.IsLinkLocalMulticast() && !ip.IsMulticast() && !ip.IsUnspecified()
}

// remoteImportClient resolves every connection itself, rather than letting the
// default transport resolve it later. That keeps a redirect or DNS rebinding
// attempt from reaching loopback or private addresses.
func remoteImportClient() *stdhttp.Client {
	dialer := &net.Dialer{Timeout: 20 * time.Second}
	transport := &stdhttp.Transport{
		Proxy: stdhttp.ProxyFromEnvironment,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			if ip := net.ParseIP(host); ip != nil {
				if !publicRemoteIP(ip) {
					return nil, errors.New("local and private network addresses are not allowed")
				}
				return dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
			}
			addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
			if err != nil {
				return nil, err
			}
			for _, candidate := range addresses {
				if publicRemoteIP(candidate.IP) {
					return dialer.DialContext(ctx, network, net.JoinHostPort(candidate.IP.String(), port))
				}
			}
			return nil, errors.New("the download host resolves only to local or private addresses")
		},
	}
	return &stdhttp.Client{
		Transport: transport,
		Timeout:   time.Hour,
		CheckRedirect: func(request *stdhttp.Request, via []*stdhttp.Request) error {
			if len(via) >= 5 {
				return errors.New("too many download redirects")
			}
			_, err := remoteImportURL(request.URL.String())
			return err
		},
	}
}

func remoteImportName(u *url.URL, header stdhttp.Header) (string, error) {
	name := ""
	if disposition := header.Get("Content-Disposition"); disposition != "" {
		if _, params, err := mime.ParseMediaType(disposition); err == nil {
			name = params["filename"]
		}
	}
	if name == "" {
		name = path.Base(u.Path)
	}
	name = path.Base(strings.ReplaceAll(name, "\\", "/"))
	lower := strings.ToLower(name)
	if name == "." || name == "" || (!strings.HasSuffix(lower, ".iso") && !strings.HasSuffix(lower, ".7z")) {
		return "", errors.New("the download must be named with a .iso or .7z extension")
	}
	return name, nil
}

func downloadRemoteImport(ctx context.Context, rawURL string) (string, string, error) {
	u, err := remoteImportURL(rawURL)
	if err != nil {
		return "", "", err
	}
	response, err := remoteImportClient().Do((&stdhttp.Request{Method: stdhttp.MethodGet, URL: u}).WithContext(ctx))
	if err != nil {
		return "", "", fmt.Errorf("download failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != stdhttp.StatusOK {
		return "", "", fmt.Errorf("download returned HTTP %d", response.StatusCode)
	}
	if response.ContentLength > remoteImportMaxBytes {
		return "", "", errors.New("the download exceeds the 32 GiB limit")
	}
	name, err := remoteImportName(response.Request.URL, response.Header)
	if err != nil {
		return "", "", err
	}
	tempDir, err := os.MkdirTemp("", "godsend-webui-remote-import-")
	if err != nil {
		return "", "", err
	}
	filePath := filepath.Join(tempDir, name)
	file, err := os.OpenFile(filePath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		os.RemoveAll(tempDir)
		return "", "", err
	}
	size, copyErr := io.Copy(file, io.LimitReader(response.Body, remoteImportMaxBytes+1))
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil || size == 0 || size > remoteImportMaxBytes {
		os.RemoveAll(tempDir)
		if copyErr != nil {
			return "", "", copyErr
		}
		if closeErr != nil {
			return "", "", closeErr
		}
		if size > remoteImportMaxBytes {
			return "", "", errors.New("the download exceeds the 32 GiB limit")
		}
		return "", "", errors.New("the download is empty")
	}
	return name, filePath, nil
}

func sevenZipCommand() (string, error) {
	for _, candidate := range []string{"7zz", "7z", "7za"} {
		if command, err := exec.LookPath(candidate); err == nil {
			return command, nil
		}
	}
	return "", errors.New(".7z import requires 7z, 7zz, or 7za to be installed on the GODsend host")
}

func extractRemoteISO(ctx context.Context, archive string) (string, error) {
	command, err := sevenZipCommand()
	if err != nil {
		return "", err
	}
	directory, err := os.MkdirTemp("", "godsend-webui-remote-extract-")
	if err != nil {
		return "", err
	}
	result := exec.CommandContext(ctx, command, "x", "-y", "-o"+directory, archive)
	if output, err := result.CombinedOutput(); err != nil {
		os.RemoveAll(directory)
		return "", fmt.Errorf("could not extract the .7z archive: %s", strings.TrimSpace(string(output)))
	}
	var iso string
	err = filepath.WalkDir(directory, func(filePath string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 || entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".iso") {
			return nil
		}
		if iso != "" {
			return errors.New("the .7z archive must contain exactly one ISO")
		}
		info, err := entry.Info()
		if err != nil || info.Size() == 0 || info.Size() > remoteImportMaxBytes {
			return errors.New("the extracted ISO is empty or exceeds the 32 GiB limit")
		}
		iso = filePath
		return nil
	})
	if err != nil || iso == "" {
		os.RemoveAll(directory)
		if err != nil {
			return "", err
		}
		return "", errors.New("the .7z archive does not contain an ISO")
	}
	return iso, nil
}

// handleWebUIImportISO fetches an authorized direct ISO URL onto the GODsend
// host. A .7z archive is extracted locally, then its single ISO is placed in
// Transfer so the existing Local catalog can use it.
//
// POST /webui/import-iso  {"url":"https://example.invalid/game.iso"}
func (d *Deps) handleWebUIImportISO(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if r.Method != stdhttp.MethodPost {
		jsonError(w, stdhttp.StatusMethodNotAllowed, "POST required")
		return
	}
	if d.App == nil || d.App.TransferDir == "" {
		jsonError(w, stdhttp.StatusInternalServerError, "the Transfer folder is not configured")
		return
	}
	r.Body = stdhttp.MaxBytesReader(w, r.Body, 16<<10)
	var request remoteImportRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		jsonError(w, stdhttp.StatusBadRequest, "a JSON body with url is required")
		return
	}
	u, err := remoteImportURL(request.URL)
	if err != nil {
		jsonError(w, stdhttp.StatusBadRequest, err.Error())
		return
	}
	if _, busy := remoteImportsInProgress.LoadOrStore(u.String(), struct{}{}); busy {
		jsonError(w, stdhttp.StatusConflict, "this URL is already being imported")
		return
	}
	defer remoteImportsInProgress.Delete(u.String())

	name, downloaded, err := downloadRemoteImport(r.Context(), u.String())
	if err != nil {
		d.App.Logf("REMOTE IMPORT: %s failed: %v", u.Hostname(), err)
		jsonError(w, stdhttp.StatusBadGateway, err.Error())
		return
	}
	defer os.RemoveAll(filepath.Dir(downloaded))
	input := downloaded
	if strings.HasSuffix(strings.ToLower(name), ".7z") {
		input, err = extractRemoteISO(r.Context(), downloaded)
		if err != nil {
			d.App.Logf("REMOTE IMPORT: %s failed: %v", name, err)
			jsonError(w, stdhttp.StatusBadRequest, err.Error())
			return
		}
		defer os.RemoveAll(filepath.Dir(input))
	}
	file, err := os.Open(input)
	if err != nil {
		jsonError(w, stdhttp.StatusInternalServerError, err.Error())
		return
	}
	defer file.Close()
	storedName, size, err := storeISO(d.App.TransferDir, filepath.Base(input), file)
	if err != nil {
		var uploadErr *isoUploadError
		code := stdhttp.StatusInternalServerError
		if errors.As(err, &uploadErr) {
			code = uploadErr.code
		}
		jsonError(w, code, err.Error())
		return
	}
	d.App.Logf("REMOTE IMPORT: saved %s (%d bytes) to the Transfer folder", storedName, size)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "name": storedName, "size": size})
}
