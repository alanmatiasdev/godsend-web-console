package app

import "sync"

// WebUILog is one line emitted through App.Logf.
type WebUILog struct {
	ID   uint64 `json:"id"`
	Line string `json:"line"`
}

var webUIEvents struct {
	sync.RWMutex
	logs       []WebUILog
	nextID     uint64
	ftpOnReady func(gameName, titleID, xboxIP string)
}

// AppendWebUILog keeps a bounded, process-local history for the embedded UI.
func AppendWebUILog(line string) {
	webUIEvents.Lock()
	defer webUIEvents.Unlock()
	webUIEvents.nextID++
	webUIEvents.logs = append(webUIEvents.logs, WebUILog{ID: webUIEvents.nextID, Line: line})
	if len(webUIEvents.logs) > 500 {
		webUIEvents.logs = append([]WebUILog(nil), webUIEvents.logs[len(webUIEvents.logs)-500:]...)
	}
}

func RecentWebUILogs(after uint64) []WebUILog {
	webUIEvents.RLock()
	defer webUIEvents.RUnlock()
	result := make([]WebUILog, 0, len(webUIEvents.logs))
	for _, entry := range webUIEvents.logs {
		if entry.ID > after {
			result = append(result, entry)
		}
	}
	return result
}

// SetWebUIFTPCompleteHook installs the optional post-transfer automation.
func SetWebUIFTPCompleteHook(hook func(gameName, titleID, xboxIP string)) {
	webUIEvents.Lock()
	webUIEvents.ftpOnReady = hook
	webUIEvents.Unlock()
}

func NotifyWebUIFTPComplete(gameName, titleID, xboxIP string) {
	webUIEvents.RLock()
	hook := webUIEvents.ftpOnReady
	webUIEvents.RUnlock()
	if hook != nil {
		hook(gameName, titleID, xboxIP)
	}
}
