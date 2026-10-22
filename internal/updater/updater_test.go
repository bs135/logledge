package updater

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"0.4.0", "0.4.0", 0},
		{"v0.4.0", "0.4.0", 0},
		{"0.4.1", "0.4.0", 1},
		{"0.5.0", "0.4.9", 1},
		{"1.0.0", "0.99.99", 1},
		{"0.3.1", "0.4.0", -1},
		{"0.10.0", "0.9.0", 1},
		{"1.0", "1.0.0", 0},
		{"1.0.0-beta", "1.0.0", -1},
		{"1.0.0", "1.0.0-rc.1", 1},
		{"1.0.0-rc.2", "1.0.0-rc.1", 1},
		{"1.0.0+build.5", "1.0.0", 0},
	}
	for _, c := range cases {
		if got := CompareVersions(c.a, c.b); got != c.want {
			t.Errorf("CompareVersions(%q, %q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

func newTestChecker(t *testing.T, status int, body string) *Checker {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") == "" {
			t.Error("missing User-Agent header")
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return &Checker{HTTPClient: srv.Client(), APIURL: srv.URL}
}

func TestCheckNewerReleaseAvailable(t *testing.T) {
	c := newTestChecker(t, http.StatusOK, `{
		"tag_name": "v0.5.0",
		"name": "v0.5.0",
		"html_url": "https://github.com/bs135/logledge/releases/tag/v0.5.0",
		"published_at": "2026-10-22T10:05:04Z"
	}`)
	info, err := c.Check(context.Background(), "0.4.0")
	if err != nil {
		t.Fatalf("Check returned error: %v", err)
	}
	if !info.Available {
		t.Fatalf("expected update to be available: %+v", info)
	}
	if info.LatestVersion != "0.5.0" || info.CurrentVersion != "0.4.0" {
		t.Errorf("unexpected versions: %+v", info)
	}
	if info.ReleaseURL != "https://github.com/bs135/logledge/releases/tag/v0.5.0" {
		t.Errorf("unexpected release URL: %s", info.ReleaseURL)
	}
}

func TestCheckUpToDate(t *testing.T) {
	c := newTestChecker(t, http.StatusOK, `{"tag_name": "v0.4.0", "html_url": "https://github.com/bs135/logledge/releases/tag/v0.4.0"}`)
	info, err := c.Check(context.Background(), "v0.4.0")
	if err != nil {
		t.Fatalf("Check returned error: %v", err)
	}
	if info.Available {
		t.Errorf("expected no update: %+v", info)
	}
}

func TestCheckIgnoresPrerelease(t *testing.T) {
	c := newTestChecker(t, http.StatusOK, `{"tag_name": "v9.0.0", "prerelease": true}`)
	info, err := c.Check(context.Background(), "0.4.0")
	if err != nil {
		t.Fatalf("Check returned error: %v", err)
	}
	if info.Available || info.LatestVersion != "" {
		t.Errorf("prerelease should be ignored: %+v", info)
	}
}

func TestCheckRejectsForeignReleaseURL(t *testing.T) {
	c := newTestChecker(t, http.StatusOK, `{"tag_name": "v1.0.0", "html_url": "https://evil.example.com/x"}`)
	info, err := c.Check(context.Background(), "0.4.0")
	if err != nil {
		t.Fatalf("Check returned error: %v", err)
	}
	if info.ReleaseURL != ReleasesPageURL {
		t.Errorf("expected fallback release URL, got %s", info.ReleaseURL)
	}
}

func TestCheckHTTPError(t *testing.T) {
	c := newTestChecker(t, http.StatusForbidden, `{"message": "rate limited"}`)
	if _, err := c.Check(context.Background(), "0.4.0"); err == nil {
		t.Fatal("expected error for non-200 response")
	}
}
