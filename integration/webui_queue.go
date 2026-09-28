package http

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	stdhttp "net/http"
	"net/http/httptest"

	"godsend/models"
)

// The scheduler holds games back until GODsend has room for them. GODsend itself
// starts every triggered job immediately and cannot pause a running one, so the
// controls here apply to games that have not been triggered yet: the waiting
// queue (paused/held/reordered/started on demand) and the wish list (prepared
// entries that are not sent to GODsend at all until the user decides).

const (
	queueMaxItems      = 1000
	queueMaxConcurrent = 10
	queueTickInterval  = 2 * time.Second
	queueReleaseGrace  = 15 * time.Second
	queueStateFile     = "webui-queue.json"
)

type queueItem struct {
	ID          string `json:"id"`
	Game        string `json:"game"`
	Platform    string `json:"platform"`
	Source      string `json:"source"`
	IP          string `json:"ip"`
	Drive       string `json:"drive"`
	InstallType string `json:"installType"`
	Held        bool   `json:"held"`
	Error       string `json:"error,omitempty"`
}

type queueState struct {
	Paused        bool        `json:"paused"`
	MaxConcurrent int         `json:"maxConcurrent"`
	Wishlist      []queueItem `json:"wishlist"`
	Pending       []queueItem `json:"pending"`
}

// queueRequest is the body of POST /webui/queue/action.
type queueRequest struct {
	Action      string     `json:"action"`
	ID          string     `json:"id"`
	IDs         []string   `json:"ids"`
	Item        *queueItem `json:"item"`
	Value       int        `json:"value"`
	Direction   string     `json:"direction"`
	Drive       string     `json:"drive"`
	InstallType string     `json:"installType"`
}

type queueResponse struct {
	queueState
	Skipped []string `json:"skipped,omitempty"`
}

type queueError struct {
	Code    int
	Message string
}

func (e *queueError) Error() string { return e.Message }

func badQueueRequest(format string, args ...interface{}) error {
	return &queueError{Code: stdhttp.StatusBadRequest, Message: fmt.Sprintf(format, args...)}
}

func conflictQueueRequest(format string, args ...interface{}) error {
	return &queueError{Code: stdhttp.StatusConflict, Message: fmt.Sprintf(format, args...)}
}

// scheduler owns the persisted queue state. Everything that touches GODsend is
// injected so the logic can be tested on its own.
type scheduler struct {
	mu       sync.Mutex // guards st, released
	tickMu   sync.Mutex // serialises releases so a slot is never handed out twice
	path     string
	st       queueState
	released map[string]time.Time

	release       func(queueItem) error
	jobStates     func() map[string]string
	clearFinished func() int
	now           func() time.Time
	logf          func(string, ...interface{})
}

func newScheduler(path string) *scheduler {
	s := &scheduler{
		path:     path,
		released: map[string]time.Time{},
		now:      time.Now,
		logf:     func(string, ...interface{}) {},
	}
	s.st = queueState{MaxConcurrent: 1, Wishlist: []queueItem{}, Pending: []queueItem{}}
	if data, err := os.ReadFile(path); err == nil {
		var saved queueState
		if json.Unmarshal(data, &saved) == nil {
			s.st = saved
		}
	}
	if s.st.MaxConcurrent < 1 || s.st.MaxConcurrent > queueMaxConcurrent {
		s.st.MaxConcurrent = 1
	}
	if s.st.Wishlist == nil {
		s.st.Wishlist = []queueItem{}
	}
	if s.st.Pending == nil {
		s.st.Pending = []queueItem{}
	}
	return s
}

// persist must be called with s.mu held.
func (s *scheduler) persist() {
	if s.path == "" {
		return
	}
	data, err := json.MarshalIndent(s.st, "", "  ")
	if err == nil {
		temp := s.path + ".tmp"
		if err = os.WriteFile(temp, data, 0o644); err == nil {
			err = os.Rename(temp, s.path)
		}
	}
	if err != nil {
		s.logf("QUEUE: could not save %s: %v", s.path, err)
	}
}

func (s *scheduler) snapshot() queueState {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.snapshotLocked()
}

func (s *scheduler) snapshotLocked() queueState {
	out := s.st
	out.Wishlist = append([]queueItem{}, s.st.Wishlist...)
	out.Pending = append([]queueItem{}, s.st.Pending...)
	return out
}

func newQueueID() string {
	raw := make([]byte, 8)
	if _, err := rand.Read(raw); err != nil {
		return fmt.Sprintf("%x", time.Now().UnixNano())
	}
	return hex.EncodeToString(raw)
}

// normalizeQueueItem validates a client-supplied entry and applies the same
// defaults as /register and /trigger.
func normalizeQueueItem(in *queueItem) (queueItem, error) {
	if in == nil {
		return queueItem{}, badQueueRequest("item is required")
	}
	item := queueItem{
		Game:        strings.TrimSpace(in.Game),
		Platform:    strings.TrimSpace(in.Platform),
		Source:      strings.ToLower(strings.TrimSpace(in.Source)),
		IP:          strings.TrimSpace(in.IP),
		Drive:       strings.TrimSpace(in.Drive),
		InstallType: strings.ToLower(strings.TrimSpace(in.InstallType)),
	}
	if item.Game == "" || len(item.Game) > 300 || strings.ContainsAny(item.Game, "\x00\r\n") {
		return queueItem{}, badQueueRequest("game is required")
	}
	if net.ParseIP(item.IP) == nil {
		return queueItem{}, badQueueRequest("a valid Xbox IP address is required")
	}
	if item.Platform == "" {
		item.Platform = "xbox360"
	}
	if item.Drive == "" {
		item.Drive = "Hdd1:"
	}
	switch item.Source {
	case "", "local", "minerva", "ia":
	default:
		return queueItem{}, badQueueRequest("unknown source %q", item.Source)
	}
	switch item.InstallType {
	case "god", "content", "xex":
	default:
		item.InstallType = "god"
	}
	item.ID = newQueueID()
	return item, nil
}

func indexOfItem(items []queueItem, id string) int {
	for i, item := range items {
		if item.ID == id {
			return i
		}
	}
	return -1
}

func containsGame(items []queueItem, game string) bool {
	for _, item := range items {
		if strings.EqualFold(item.Game, game) {
			return true
		}
	}
	return false
}

func moveItem(items []queueItem, index int, direction string) ([]queueItem, error) {
	target := index
	switch direction {
	case "up":
		target = index - 1
	case "down":
		target = index + 1
	case "top":
		target = 0
	case "bottom":
		target = len(items) - 1
	default:
		return items, badQueueRequest("unknown direction %q", direction)
	}
	if target < 0 || target >= len(items) || target == index {
		return items, nil
	}
	item := items[index]
	items = append(items[:index], items[index+1:]...)
	items = append(items[:target], append([]queueItem{item}, items[target:]...)...)
	return items, nil
}

// apply runs one client action and returns the resulting state. Releases are
// triggered by the caller afterwards (see run).
func (s *scheduler) apply(req queueRequest) (queueResponse, error) {
	if req.Action == "start" {
		return s.startNow(req.ID)
	}
	if req.Action == "clear_finished" {
		if s.clearFinished != nil {
			s.logf("QUEUE: cleared %d finished job(s)", s.clearFinished())
		}
		return queueResponse{queueState: s.snapshot()}, nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	var skipped []string
	switch req.Action {
	case "enqueue":
		item, err := normalizeQueueItem(req.Item)
		if err != nil {
			return queueResponse{}, err
		}
		if len(s.st.Pending) >= queueMaxItems {
			return queueResponse{}, badQueueRequest("the waiting queue is full")
		}
		if containsGame(s.st.Pending, item.Game) {
			return queueResponse{}, conflictQueueRequest("%q is already waiting in the queue", item.Game)
		}
		s.st.Pending = append(s.st.Pending, item)
	case "wishlist_add":
		item, err := normalizeQueueItem(req.Item)
		if err != nil {
			return queueResponse{}, err
		}
		if len(s.st.Wishlist) >= queueMaxItems {
			return queueResponse{}, badQueueRequest("the wish list is full")
		}
		if containsGame(s.st.Wishlist, item.Game) {
			return queueResponse{}, conflictQueueRequest("%q is already in the wish list", item.Game)
		}
		s.st.Wishlist = append(s.st.Wishlist, item)
	case "wishlist_update":
		index := indexOfItem(s.st.Wishlist, req.ID)
		if index < 0 {
			return queueResponse{}, &queueError{Code: stdhttp.StatusNotFound, Message: "wish list entry not found"}
		}
		if drive := strings.TrimSpace(req.Drive); drive != "" {
			s.st.Wishlist[index].Drive = drive
		}
		switch strings.ToLower(strings.TrimSpace(req.InstallType)) {
		case "god", "content", "xex":
			s.st.Wishlist[index].InstallType = strings.ToLower(strings.TrimSpace(req.InstallType))
		}
	case "wishlist_remove":
		index := indexOfItem(s.st.Wishlist, req.ID)
		if index < 0 {
			return queueResponse{}, &queueError{Code: stdhttp.StatusNotFound, Message: "wish list entry not found"}
		}
		s.st.Wishlist = append(s.st.Wishlist[:index], s.st.Wishlist[index+1:]...)
	case "wishlist_clear":
		s.st.Wishlist = []queueItem{}
	case "wishlist_send":
		selected := map[string]bool{}
		for _, id := range req.IDs {
			selected[id] = true
		}
		kept := make([]queueItem, 0, len(s.st.Wishlist))
		for _, item := range s.st.Wishlist {
			if len(selected) > 0 && !selected[item.ID] {
				kept = append(kept, item)
				continue
			}
			if containsGame(s.st.Pending, item.Game) || len(s.st.Pending) >= queueMaxItems {
				skipped = append(skipped, item.Game)
				kept = append(kept, item)
				continue
			}
			item.Held, item.Error = false, ""
			s.st.Pending = append(s.st.Pending, item)
		}
		s.st.Wishlist = kept
	case "to_wishlist":
		index := indexOfItem(s.st.Pending, req.ID)
		if index < 0 {
			return queueResponse{}, &queueError{Code: stdhttp.StatusNotFound, Message: "queue entry not found"}
		}
		item := s.st.Pending[index]
		if containsGame(s.st.Wishlist, item.Game) {
			return queueResponse{}, conflictQueueRequest("%q is already in the wish list", item.Game)
		}
		item.Held, item.Error = false, ""
		s.st.Pending = append(s.st.Pending[:index], s.st.Pending[index+1:]...)
		s.st.Wishlist = append(s.st.Wishlist, item)
	case "pause":
		s.st.Paused = true
	case "resume":
		s.st.Paused = false
	case "set_max":
		if req.Value < 1 || req.Value > queueMaxConcurrent {
			return queueResponse{}, badQueueRequest("simultaneous jobs must be between 1 and %d", queueMaxConcurrent)
		}
		s.st.MaxConcurrent = req.Value
	case "remove", "hold", "unhold", "move":
		index := indexOfItem(s.st.Pending, req.ID)
		if index < 0 {
			return queueResponse{}, &queueError{Code: stdhttp.StatusNotFound, Message: "queue entry not found"}
		}
		switch req.Action {
		case "remove":
			s.st.Pending = append(s.st.Pending[:index], s.st.Pending[index+1:]...)
		case "hold":
			s.st.Pending[index].Held = true
		case "unhold":
			s.st.Pending[index].Held, s.st.Pending[index].Error = false, ""
		case "move":
			moved, err := moveItem(s.st.Pending, index, req.Direction)
			if err != nil {
				return queueResponse{}, err
			}
			s.st.Pending = moved
		}
	case "clear_pending":
		s.st.Pending = []queueItem{}
	default:
		return queueResponse{}, badQueueRequest("unknown action %q", req.Action)
	}
	s.persist()
	return queueResponse{queueState: s.snapshotLocked(), Skipped: skipped}, nil
}

// startNow triggers one waiting entry immediately, ignoring pause, hold, and
// the simultaneous-job limit.
func (s *scheduler) startNow(id string) (queueResponse, error) {
	s.tickMu.Lock()
	defer s.tickMu.Unlock()
	s.mu.Lock()
	index := indexOfItem(s.st.Pending, id)
	if index < 0 {
		s.mu.Unlock()
		return queueResponse{}, &queueError{Code: stdhttp.StatusNotFound, Message: "queue entry not found"}
	}
	item := s.st.Pending[index]
	s.mu.Unlock()
	_ = s.releaseOne(item) // a failure is recorded on the entry and shown to the user
	return queueResponse{queueState: s.snapshot()}, nil
}

// releaseOne triggers an entry and updates the queue with the outcome. The
// caller must hold tickMu. It returns the release error, if any.
func (s *scheduler) releaseOne(item queueItem) error {
	err := s.release(item)
	s.mu.Lock()
	defer s.mu.Unlock()
	index := indexOfItem(s.st.Pending, item.ID)
	if index < 0 {
		return err
	}
	if err != nil {
		s.st.Pending[index].Error = err.Error()
		s.st.Pending[index].Held = true
		s.logf("QUEUE: could not start %q: %v", item.Game, err)
	} else {
		s.st.Pending = append(s.st.Pending[:index], s.st.Pending[index+1:]...)
		s.released[strings.ToLower(item.Game)] = s.now()
		s.logf("QUEUE: started %q", item.Game)
	}
	s.persist()
	return err
}

// activeJobs counts GODsend jobs that are working right now, plus entries this
// scheduler triggered a moment ago that GODsend has not registered yet.
func (s *scheduler) activeJobs() int {
	states := map[string]string{}
	if s.jobStates != nil {
		states = s.jobStates()
	}
	lower := make(map[string]string, len(states))
	active := 0
	for game, state := range states {
		lower[strings.ToLower(game)] = state
		if state == "Processing" {
			active++
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for game, at := range s.released {
		if _, known := lower[game]; known || s.now().Sub(at) > queueReleaseGrace {
			delete(s.released, game)
		} else {
			active++
		}
	}
	return active
}

// tick starts as many waiting entries as there is room for.
func (s *scheduler) tick() {
	s.tickMu.Lock()
	defer s.tickMu.Unlock()
	s.mu.Lock()
	if s.st.Paused {
		s.mu.Unlock()
		return
	}
	limit := s.st.MaxConcurrent
	s.mu.Unlock()
	room := limit - s.activeJobs()
	for room > 0 {
		s.mu.Lock()
		var next *queueItem
		for i := range s.st.Pending {
			if !s.st.Pending[i].Held {
				candidate := s.st.Pending[i]
				next = &candidate
				break
			}
		}
		s.mu.Unlock()
		if next == nil {
			return
		}
		// A failed release holds only that entry; it must not use up the slot.
		if s.releaseOne(*next) == nil {
			room--
		}
	}
}

// ---- GODsend wiring ---------------------------------------------------------

var (
	webQueue     *scheduler
	webQueueOnce sync.Once
)

func (d *Deps) queueScheduler() *scheduler {
	webQueueOnce.Do(func() {
		s := newScheduler(filepath.Join(d.App.ToolsDir, queueStateFile))
		s.logf = d.App.Logf
		s.release = d.releaseQueueItem
		s.jobStates = func() map[string]string {
			states := map[string]string{}
			d.App.JobQueue.Range(func(key, value interface{}) bool {
				states[key.(string)] = value.(models.GameStatus).State
				return true
			})
			return states
		}
		s.clearFinished = func() int {
			var finished []string
			d.App.JobQueue.Range(func(key, value interface{}) bool {
				if state := value.(models.GameStatus).State; state == "Ready" || state == "Error" {
					finished = append(finished, key.(string))
				}
				return true
			})
			for _, game := range finished {
				d.App.JobQueue.Delete(game)
				d.App.SuppressedJobs.Store(game, struct{}{})
			}
			return len(finished)
		}
		go func() {
			for range time.Tick(queueTickInterval) {
				s.tick()
			}
		}()
		webQueue = s
	})
	return webQueue
}

// releaseQueueItem does what the browser used to do for a direct "Add to
// queue": register the console, then trigger the job, by calling GODsend's own
// handlers so their behaviour stays authoritative.
func (d *Deps) releaseQueueItem(item queueItem) error {
	call := func(handler stdhttp.HandlerFunc, path string, params url.Values) (map[string]string, error) {
		recorder := httptest.NewRecorder()
		handler(recorder, httptest.NewRequest(stdhttp.MethodGet, path+"?"+params.Encode(), nil))
		body := map[string]string{}
		_ = json.Unmarshal(recorder.Body.Bytes(), &body)
		if recorder.Code >= 400 {
			if body["message"] != "" {
				return nil, errors.New(body["message"])
			}
			return nil, fmt.Errorf("GODsend returned status %d", recorder.Code)
		}
		return body, nil
	}
	if _, err := call(d.handleRegister, "/register", url.Values{
		"game": {item.Game}, "ip": {item.IP}, "drive": {item.Drive}, "platform": {item.Platform},
		"mode": {"ftp"}, "install_type": {item.InstallType},
	}); err != nil {
		return err
	}
	result, err := call(d.handleTrigger, "/trigger", url.Values{
		"game": {item.Game}, "platform": {item.Platform}, "source": {item.Source}, "install_type": {item.InstallType},
	})
	if err != nil {
		return err
	}
	if result["status"] == "local_unavailable" {
		if result["message"] != "" {
			return errors.New(result["message"])
		}
		return errors.New("no ISO for this game in the Transfer folder")
	}
	return nil
}

// handleWebUIQueueState returns the wish list, the waiting queue, and its settings.
//
// GET /webui/queue/state
func (d *Deps) handleWebUIQueueState(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if r.Method != stdhttp.MethodGet {
		jsonError(w, stdhttp.StatusMethodNotAllowed, "GET required")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(queueResponse{queueState: d.queueScheduler().snapshot()})
}

// handleWebUIQueueAction changes the wish list or the waiting queue.
//
// POST /webui/queue/action  {"action": "...", ...}
func (d *Deps) handleWebUIQueueAction(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if r.Method != stdhttp.MethodPost {
		jsonError(w, stdhttp.StatusMethodNotAllowed, "POST required")
		return
	}
	var req queueRequest
	if err := json.NewDecoder(stdhttp.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		jsonError(w, stdhttp.StatusBadRequest, "invalid JSON")
		return
	}
	s := d.queueScheduler()
	response, err := s.apply(req)
	if err != nil {
		code := stdhttp.StatusBadRequest
		var queueErr *queueError
		if errors.As(err, &queueErr) {
			code = queueErr.Code
		}
		jsonError(w, code, err.Error())
		return
	}
	if req.Action != "start" {
		s.tick()
		response.queueState = s.snapshot()
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
