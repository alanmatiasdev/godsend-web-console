package http

import "testing"

func TestWebUIArchivePathValidation(t *testing.T) {
	for _, value := range []string{"/Hdd1/Games", "/Usb0/Game/file.bin"} {
		if !validArchivePath(value) {
			t.Errorf("expected valid path %q", value)
		}
	}
	for _, value := range []string{"Hdd1/Games", "/Hdd1/../secret", "/Hdd1/./Games", "/Hdd1\\Games", "/Hdd1/\x00"} {
		if validArchivePath(value) {
			t.Errorf("accepted invalid path %q", value)
		}
	}
	for _, value := range []string{"", ".", "..", "a/b", "a\\b", "a\x00b"} {
		if validArchiveName(value) {
			t.Errorf("accepted invalid name %q", value)
		}
	}
}
