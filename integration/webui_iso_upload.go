package http

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"

	stdhttp "net/http"
)

const isoUploadMaxBytes = 32 << 30

// isoUploadsInProgress stops two requests from writing the same ISO at once.
var isoUploadsInProgress sync.Map

type isoUploadError struct {
	code    int
	message string
}

func (e *isoUploadError) Error() string { return e.message }

// isoUploadName reduces a browser-supplied file name to a safe ISO name for the
// Transfer folder. The Local catalog is a "|"-joined list of ISO names, so that
// character (and anything that could leave the folder) is refused.
func isoUploadName(raw string) (string, error) {
	name := path.Base(strings.ReplaceAll(raw, "\\", "/"))
	switch {
	case name == "." || name == "/" || name == "":
		return "", &isoUploadError{stdhttp.StatusBadRequest, "invalid file name"}
	case !strings.HasSuffix(strings.ToLower(name), ".iso") || len(name) == len(".iso"):
		return "", &isoUploadError{stdhttp.StatusBadRequest, "only .iso files can be uploaded"}
	case len(name) > 200 || strings.HasPrefix(name, ".") || strings.ContainsAny(name, "|:*?\"<>") || strings.IndexFunc(name, func(r rune) bool { return r < 0x20 || r == 0x7f }) >= 0:
		return "", &isoUploadError{stdhttp.StatusBadRequest, "the file name contains characters GODsend cannot use"}
	}
	return name, nil
}

// storeISO streams one upload into dir. The data lands in a ".part" file, which
// the Local catalog ignores, and is renamed only when it is complete, so a
// dropped connection never leaves a truncated ISO that could be queued.
func storeISO(dir, rawName string, source io.Reader) (string, int64, error) {
	name, err := isoUploadName(rawName)
	if err != nil {
		return "", 0, err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", 0, err
	}
	if entries, err := os.ReadDir(dir); err == nil {
		for _, entry := range entries {
			if !entry.IsDir() && strings.EqualFold(entry.Name(), name) {
				return "", 0, &isoUploadError{stdhttp.StatusConflict, name + " already exists in the Transfer folder"}
			}
		}
	}
	target := filepath.Join(dir, name)
	if _, busy := isoUploadsInProgress.LoadOrStore(strings.ToLower(target), struct{}{}); busy {
		return "", 0, &isoUploadError{stdhttp.StatusConflict, name + " is already being uploaded"}
	}
	defer isoUploadsInProgress.Delete(strings.ToLower(target))

	partial := target + ".part"
	out, err := os.OpenFile(partial, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return "", 0, err
	}
	size, err := io.CopyBuffer(out, source, make([]byte, 1<<20))
	if closeErr := out.Close(); err == nil {
		err = closeErr
	}
	if err == nil && size == 0 {
		err = &isoUploadError{stdhttp.StatusBadRequest, name + " is empty"}
	}
	if err != nil {
		os.Remove(partial)
		return "", 0, err
	}
	if err := os.Rename(partial, target); err != nil {
		os.Remove(partial)
		return "", 0, err
	}
	return name, size, nil
}

// handleWebUIUploadISO saves browser-selected ISOs into GODsend's Transfer
// folder so they show up in the Local catalog.
//
// POST /webui/upload-iso   multipart/form-data, one or more "files" parts
func (d *Deps) handleWebUIUploadISO(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if r.Method != stdhttp.MethodPost {
		jsonError(w, stdhttp.StatusMethodNotAllowed, "POST required")
		return
	}
	if d.App == nil || d.App.TransferDir == "" {
		jsonError(w, stdhttp.StatusInternalServerError, "the Transfer folder is not configured")
		return
	}
	r.Body = stdhttp.MaxBytesReader(w, r.Body, isoUploadMaxBytes)
	reader, err := r.MultipartReader()
	if err != nil {
		jsonError(w, stdhttp.StatusBadRequest, "multipart upload required")
		return
	}
	type stored struct {
		Name string `json:"name"`
		Size int64  `json:"size"`
	}
	saved := []stored{}
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			jsonError(w, stdhttp.StatusBadRequest, "the upload was interrupted or is malformed")
			return
		}
		if part.FormName() != "files" || part.FileName() == "" {
			continue
		}
		name, size, err := storeISO(d.App.TransferDir, part.FileName(), part)
		if err != nil {
			var uploadErr *isoUploadError
			code := stdhttp.StatusInternalServerError
			if errors.As(err, &uploadErr) {
				code = uploadErr.code
			}
			d.App.Logf("UPLOAD: %s failed: %v", part.FileName(), err)
			jsonError(w, code, err.Error())
			return
		}
		d.App.Logf("UPLOAD: saved %s (%d bytes) to the Transfer folder", name, size)
		saved = append(saved, stored{name, size})
	}
	if len(saved) == 0 {
		jsonError(w, stdhttp.StatusBadRequest, "no ISO files were sent")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "files": saved})
}
