package http

import (
	"bytes"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net"
	stdhttp "net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"godsend/app"
)

type fakeGodsend struct {
	states   map[string]string
	started  []string
	failWith map[string]error
}

func newTestScheduler(t *testing.T) (*scheduler, *fakeGodsend, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "queue.json")
	fake := &fakeGodsend{states: map[string]string{}, failWith: map[string]error{}}
	s := newScheduler(path)
	s.release = func(item queueItem) error {
		if err := fake.failWith[item.Game]; err != nil {
			return err
		}
		fake.started = append(fake.started, item.Game)
		fake.states[item.Game] = "Processing"
		return nil
	}
	s.jobStates = func() map[string]string {
		copied := map[string]string{}
		for game, state := range fake.states {
			copied[game] = state
		}
		return copied
	}
	return s, fake, path
}

func entry(game string) *queueItem {
	return &queueItem{Game: game, IP: "192.168.1.50", Source: "local", Platform: "local"}
}

func mustApply(t *testing.T, s *scheduler, req queueRequest) queueResponse {
	t.Helper()
	response, err := s.apply(req)
	if err != nil {
		t.Fatalf("%s: %v", req.Action, err)
	}
	return response
}

func games(items []queueItem) string {
	names := make([]string, len(items))
	for i, item := range items {
		names[i] = item.Game
	}
	return strings.Join(names, ",")
}

func TestSchedulerHonoursLimitPauseAndOrder(t *testing.T) {
	s, fake, _ := newTestScheduler(t)
	mustApply(t, s, queueRequest{Action: "pause"})
	for _, game := range []string{"A", "B", "C"} {
		mustApply(t, s, queueRequest{Action: "enqueue", Item: entry(game)})
	}
	s.tick()
	if len(fake.started) != 0 {
		t.Fatalf("paused queue started %v", fake.started)
	}
	mustApply(t, s, queueRequest{Action: "resume"})
	s.tick()
	if strings.Join(fake.started, ",") != "A" {
		t.Fatalf("limit 1 should start only A, started %v", fake.started)
	}
	s.tick()
	if len(fake.started) != 1 {
		t.Fatalf("a running job should hold the slot, started %v", fake.started)
	}
	fake.states["A"] = "Ready"
	s.tick()
	if strings.Join(fake.started, ",") != "A,B" {
		t.Fatalf("finished job should free the slot, started %v", fake.started)
	}
	mustApply(t, s, queueRequest{Action: "set_max", Value: 3})
	s.tick()
	if strings.Join(fake.started, ",") != "A,B,C" || len(s.snapshot().Pending) != 0 {
		t.Fatalf("raised limit should start the rest, started %v", fake.started)
	}
}

func TestSchedulerHoldMoveStartAndRemove(t *testing.T) {
	s, fake, _ := newTestScheduler(t)
	mustApply(t, s, queueRequest{Action: "pause"})
	var ids []string
	for _, game := range []string{"A", "B", "C"} {
		response := mustApply(t, s, queueRequest{Action: "enqueue", Item: entry(game)})
		ids = append(ids, response.Pending[len(response.Pending)-1].ID)
	}
	state := mustApply(t, s, queueRequest{Action: "move", ID: ids[2], Direction: "top"})
	if games(state.Pending) != "C,A,B" {
		t.Fatalf("move to top: %s", games(state.Pending))
	}
	state = mustApply(t, s, queueRequest{Action: "move", ID: ids[2], Direction: "down"})
	if games(state.Pending) != "A,C,B" {
		t.Fatalf("move down: %s", games(state.Pending))
	}
	mustApply(t, s, queueRequest{Action: "move", ID: ids[0], Direction: "up"}) // already first: no-op
	mustApply(t, s, queueRequest{Action: "hold", ID: ids[0]})
	mustApply(t, s, queueRequest{Action: "resume"})
	s.tick()
	if strings.Join(fake.started, ",") != "C" {
		t.Fatalf("held A must be skipped, started %v", fake.started)
	}
	mustApply(t, s, queueRequest{Action: "start", ID: ids[0]}) // ignores hold and the limit
	if strings.Join(fake.started, ",") != "C,A" {
		t.Fatalf("start now: %v", fake.started)
	}
	state = mustApply(t, s, queueRequest{Action: "remove", ID: ids[1]})
	if len(state.Pending) != 0 {
		t.Fatalf("remove: %s", games(state.Pending))
	}
	if _, err := s.apply(queueRequest{Action: "remove", ID: "missing"}); err == nil {
		t.Fatal("removing an unknown entry must fail")
	}
	if _, err := s.apply(queueRequest{Action: "move", ID: ids[0], Direction: "sideways"}); err == nil {
		t.Fatal("unknown direction must fail")
	}
}

func TestSchedulerReleaseFailureHoldsEntryUntilRetried(t *testing.T) {
	s, fake, _ := newTestScheduler(t)
	fake.failWith["Bad"] = errors.New("No ISO in Transfer folder")
	mustApply(t, s, queueRequest{Action: "enqueue", Item: entry("Bad")})
	mustApply(t, s, queueRequest{Action: "enqueue", Item: entry("Good")})
	s.tick()
	if strings.Join(fake.started, ",") != "Good" {
		t.Fatalf("a failed release must not use up the slot, started %v", fake.started)
	}
	pending := s.snapshot().Pending
	if len(pending) != 1 || pending[0].Game != "Bad" || !pending[0].Held || pending[0].Error == "" {
		t.Fatalf("failed entry should stay held with its error, got %+v", pending)
	}
	s.tick()
	if len(fake.started) != 1 {
		t.Fatalf("a held failed entry must not be retried automatically, started %v", fake.started)
	}
	delete(fake.failWith, "Bad")
	fake.states["Good"] = "Ready"
	after := mustApply(t, s, queueRequest{Action: "unhold", ID: pending[0].ID}).Pending
	if len(after) != 1 || after[0].Held || after[0].Error != "" {
		t.Fatalf("unhold should clear the hold and the error: %+v", after)
	}
	s.tick()
	if strings.Join(fake.started, ",") != "Good,Bad" || len(s.snapshot().Pending) != 0 {
		t.Fatalf("retried entry should start, started %v", fake.started)
	}
}

func TestSchedulerCountsJobsItJustTriggered(t *testing.T) {
	s, fake, _ := newTestScheduler(t)
	now := time.Now()
	s.now = func() time.Time { return now }
	s.release = func(item queueItem) error { fake.started = append(fake.started, item.Game); return nil } // GODsend has not registered a job yet
	mustApply(t, s, queueRequest{Action: "pause"})
	mustApply(t, s, queueRequest{Action: "enqueue", Item: entry("A")})
	mustApply(t, s, queueRequest{Action: "enqueue", Item: entry("B")})
	mustApply(t, s, queueRequest{Action: "resume"})
	s.tick()
	s.tick()
	if strings.Join(fake.started, ",") != "A" {
		t.Fatalf("a just-triggered job must hold its slot, started %v", fake.started)
	}
	now = now.Add(queueReleaseGrace + time.Second)
	s.tick()
	if strings.Join(fake.started, ",") != "A,B" {
		t.Fatalf("an unregistered job must stop holding its slot after the grace period, started %v", fake.started)
	}
}

func TestWishlistFlow(t *testing.T) {
	s, fake, path := newTestScheduler(t)
	mustApply(t, s, queueRequest{Action: "pause"})
	for _, game := range []string{"A", "B", "C"} {
		mustApply(t, s, queueRequest{Action: "wishlist_add", Item: entry(game)})
	}
	if _, err := s.apply(queueRequest{Action: "wishlist_add", Item: entry("a")}); err == nil {
		t.Fatal("duplicate wish list entry (case-insensitive) must be refused")
	}
	if _, err := s.apply(queueRequest{Action: "wishlist_add", Item: &queueItem{Game: "X", IP: "not-an-ip"}}); err == nil {
		t.Fatal("invalid IP must be refused")
	}
	state := s.snapshot()
	mustApply(t, s, queueRequest{Action: "wishlist_update", ID: state.Wishlist[1].ID, Drive: "Usb0:", InstallType: "xex"})
	mustApply(t, s, queueRequest{Action: "enqueue", Item: entry("A")})
	response := mustApply(t, s, queueRequest{Action: "wishlist_send", IDs: []string{state.Wishlist[0].ID, state.Wishlist[1].ID}})
	if games(response.Pending) != "A,B" || len(response.Skipped) != 1 || response.Skipped[0] != "A" {
		t.Fatalf("send selected: pending=%s skipped=%v", games(response.Pending), response.Skipped)
	}
	if games(response.Wishlist) != "A,C" {
		t.Fatalf("skipped entry must stay in the wish list, got %s", games(response.Wishlist))
	}
	if response.Pending[1].Drive != "Usb0:" || response.Pending[1].InstallType != "xex" {
		t.Fatalf("wish list edits were lost: %+v", response.Pending[1])
	}
	response = mustApply(t, s, queueRequest{Action: "to_wishlist", ID: response.Pending[1].ID})
	if games(response.Wishlist) != "A,C,B" || games(response.Pending) != "A" {
		t.Fatalf("to_wishlist: wish=%s pending=%s", games(response.Wishlist), games(response.Pending))
	}
	response = mustApply(t, s, queueRequest{Action: "wishlist_send"})
	if games(response.Pending) != "A,C,B" || len(response.Skipped) != 1 || response.Skipped[0] != "A" {
		t.Fatalf("send all: pending=%s skipped=%v", games(response.Pending), response.Skipped)
	}
	if len(fake.started) != 0 {
		t.Fatalf("the wish list must never trigger GODsend, started %v", fake.started)
	}

	reloaded := newScheduler(path)
	if games(reloaded.snapshot().Pending) != games(s.snapshot().Pending) || !reloaded.snapshot().Paused {
		t.Fatalf("state was not persisted: %+v", reloaded.snapshot())
	}
}

func TestClearFinishedUsesGodsendHook(t *testing.T) {
	s, _, _ := newTestScheduler(t)
	cleared := 0
	s.clearFinished = func() int { cleared++; return 2 }
	mustApply(t, s, queueRequest{Action: "clear_finished"})
	if cleared != 1 {
		t.Fatal("clear_finished did not call GODsend")
	}
}

func TestQueueRoutesReportErrors(t *testing.T) {
	deps := &Deps{App: app.NewApp()}
	deps.App.ToolsDir = t.TempDir()
	mux := deps.NewRouter()
	post := func(body string) *httptest.ResponseRecorder {
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest("POST", "/webui/queue/action", strings.NewReader(body)))
		return response
	}
	if response := post(`{"action":"nope"}`); response.Code != 400 {
		t.Fatalf("unknown action: %d %s", response.Code, response.Body.String())
	}
	if response := post(`{"action":"remove","id":"x"}`); response.Code != 404 {
		t.Fatalf("unknown id: %d", response.Code)
	}
	if response := post(`{`); response.Code != 400 {
		t.Fatalf("bad JSON: %d", response.Code)
	}
	if response := post(`{"action":"pause"}`); response.Code != 200 || !strings.Contains(response.Body.String(), `"paused":true`) {
		t.Fatalf("pause: %d %s", response.Code, response.Body.String())
	}
	state := httptest.NewRecorder()
	mux.ServeHTTP(state, httptest.NewRequest("GET", "/webui/queue/state", nil))
	var body queueState
	if state.Code != 200 || json.Unmarshal(state.Body.Bytes(), &body) != nil || !body.Paused || body.Wishlist == nil || body.Pending == nil {
		t.Fatalf("state: %d %s", state.Code, state.Body.String())
	}
}

func TestISOUploadName(t *testing.T) {
	for input, want := range map[string]string{
		"Halo 3.iso": "Halo 3.iso", `C:\isos\Forza (USA).ISO`: "Forza (USA).ISO", "../../etc/Game.iso": "Game.iso",
	} {
		if got, err := isoUploadName(input); err != nil || got != want {
			t.Errorf("isoUploadName(%q) = %q, %v; want %q", input, got, err, want)
		}
	}
	for _, input := range []string{"", "game.zip", ".iso", "a|b.iso", ".hidden.iso", "a\x00b.iso", "dir/", strings.Repeat("x", 201) + ".iso"} {
		if got, err := isoUploadName(input); err == nil {
			t.Errorf("isoUploadName(%q) = %q, want an error", input, got)
		}
	}
}

func TestRemoteImportURLSafety(t *testing.T) {
	if got, err := remoteImportURL("https://downloads.example/game.iso"); err != nil || got.Hostname() != "downloads.example" {
		t.Fatalf("remoteImportURL valid URL = %v, %v", got, err)
	}
	for _, raw := range []string{"file:///tmp/game.iso", "ftp://downloads.example/game.iso", "https://user:pass@downloads.example/game.iso", "http://127.0.0.1/game.iso", "http://[::1]/game.iso"} {
		if _, err := remoteImportURL(raw); err == nil {
			t.Errorf("remoteImportURL(%q) accepted an unsafe URL", raw)
		}
	}
	for _, ip := range []string{"127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.1.1", "::1", "0.0.0.0"} {
		if publicRemoteIP(net.ParseIP(ip)) {
			t.Errorf("publicRemoteIP(%q) = true", ip)
		}
	}
	if !publicRemoteIP(net.ParseIP("1.1.1.1")) {
		t.Error("publicRemoteIP rejected a public address")
	}
}

func TestRemoteImportName(t *testing.T) {
	u, _ := url.Parse("https://downloads.example/releases/latest")
	name, err := remoteImportName(u, stdhttp.Header{"Content-Disposition": {`attachment; filename="game.7z"`}})
	if err != nil || name != "game.7z" {
		t.Fatalf("remoteImportName from header = %q, %v", name, err)
	}
	u, _ = url.Parse("https://downloads.example/Game.ISO")
	if name, err := remoteImportName(u, stdhttp.Header{}); err != nil || name != "Game.ISO" {
		t.Fatalf("remoteImportName from URL = %q, %v", name, err)
	}
	if _, err := remoteImportName(u, stdhttp.Header{"Content-Disposition": {`attachment; filename="game.zip"`}}); err == nil {
		t.Error("remoteImportName accepted a non-ISO archive")
	}
}

func TestISOUploadStoresCompleteFilesOnly(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "Transfer")
	deps := &Deps{App: app.NewApp()}
	deps.App.TransferDir = dir
	mux := deps.NewRouter()

	send := func(name, content string) *httptest.ResponseRecorder {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		part, _ := writer.CreateFormFile("files", name)
		part.Write([]byte(content))
		writer.Close()
		request := httptest.NewRequest("POST", "/webui/upload-iso", &body)
		request.Header.Set("Content-Type", writer.FormDataContentType())
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, request)
		return response
	}

	if response := send("Halo 3.iso", "ISO-DATA"); response.Code != 200 || !strings.Contains(response.Body.String(), `"size":8`) {
		t.Fatalf("upload: %d %s", response.Code, response.Body.String())
	}
	if data, err := os.ReadFile(filepath.Join(dir, "Halo 3.iso")); err != nil || string(data) != "ISO-DATA" {
		t.Fatalf("stored file: %q, %v", data, err)
	}
	if response := send("halo 3.ISO", "other"); response.Code != 409 {
		t.Fatalf("duplicate name (case-insensitive) must be refused, got %d", response.Code)
	}
	if response := send("notes.txt", "x"); response.Code != 400 {
		t.Fatalf("non-ISO must be refused, got %d", response.Code)
	}
	if response := send("Empty.iso", ""); response.Code != 400 {
		t.Fatalf("empty file must be refused, got %d", response.Code)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		names := []string{}
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Fatalf("no partial files may be left behind, found %v", names)
	}

	// A body that is cut off mid-file must not produce an ISO.
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, _ := writer.CreateFormFile("files", "Cut.iso")
	part.Write(bytes.Repeat([]byte("x"), 4096))
	truncated := body.Bytes() // no closing boundary
	request := httptest.NewRequest("POST", "/webui/upload-iso", bytes.NewReader(truncated))
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code == 200 {
		t.Fatalf("truncated upload reported success: %s", response.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, "Cut.iso")); err == nil {
		t.Fatal("truncated upload left an ISO in the Transfer folder")
	}
	if _, err := os.Stat(filepath.Join(dir, "Cut.iso.part")); err == nil {
		t.Fatal("truncated upload left a .part file")
	}
}
