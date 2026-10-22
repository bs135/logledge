// Package updater checks GitHub Releases for a newer version of the application.
package updater

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	// RepoOwner and RepoName identify the GitHub repository that publishes releases.
	RepoOwner = "bs135"
	RepoName  = "logledge"

	defaultTimeout = 10 * time.Second
	maxBodyBytes   = 1 << 20
)

// ReleasesPageURL is the public GitHub releases page, used as a safe fallback link.
var ReleasesPageURL = fmt.Sprintf("https://github.com/%s/%s/releases", RepoOwner, RepoName)

// Info describes the outcome of an update check.
type Info struct {
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	ReleaseName    string `json:"releaseName"`
	ReleaseURL     string `json:"releaseUrl"`
	PublishedAt    string `json:"publishedAt"`
	Available      bool   `json:"available"`
}

// Checker queries the GitHub Releases API for the latest published release.
type Checker struct {
	HTTPClient *http.Client
	APIURL     string
}

// New returns a Checker targeting the latest release of the Logledge repository.
func New() *Checker {
	return &Checker{
		HTTPClient: &http.Client{Timeout: defaultTimeout},
		APIURL:     fmt.Sprintf("https://api.github.com/repos/%s/%s/releases/latest", RepoOwner, RepoName),
	}
}

type githubRelease struct {
	TagName     string `json:"tag_name"`
	Name        string `json:"name"`
	HTMLURL     string `json:"html_url"`
	PublishedAt string `json:"published_at"`
	Draft       bool   `json:"draft"`
	Prerelease  bool   `json:"prerelease"`
}

// Check fetches the latest release and compares it against currentVersion.
func (c *Checker) Check(ctx context.Context, currentVersion string) (Info, error) {
	info := Info{CurrentVersion: normalizeVersion(currentVersion)}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.APIURL, nil)
	if err != nil {
		return info, fmt.Errorf("build update request: %w", err)
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "Logledge/"+info.CurrentVersion)

	client := c.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: defaultTimeout}
	}
	resp, err := client.Do(req)
	if err != nil {
		return info, fmt.Errorf("fetch latest release: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return info, fmt.Errorf("fetch latest release: unexpected status %s", resp.Status)
	}

	var rel githubRelease
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxBodyBytes)).Decode(&rel); err != nil {
		return info, fmt.Errorf("decode latest release: %w", err)
	}
	if rel.Draft || rel.Prerelease || strings.TrimSpace(rel.TagName) == "" {
		return info, nil
	}

	info.LatestVersion = normalizeVersion(rel.TagName)
	info.ReleaseName = rel.Name
	info.PublishedAt = rel.PublishedAt
	info.ReleaseURL = safeReleaseURL(rel.HTMLURL)
	info.Available = CompareVersions(info.LatestVersion, info.CurrentVersion) > 0
	return info, nil
}

// safeReleaseURL only accepts links pointing at this repository's releases on
// github.com, since the URL is opened in the user's browser.
func safeReleaseURL(raw string) string {
	if strings.HasPrefix(raw, ReleasesPageURL+"/") {
		return raw
	}
	return ReleasesPageURL
}

func normalizeVersion(v string) string {
	v = strings.TrimSpace(v)
	return strings.TrimPrefix(strings.TrimPrefix(v, "v"), "V")
}

// CompareVersions compares two semantic versions (an optional "v" prefix is
// ignored). It returns 1 if a > b, -1 if a < b and 0 if they are equal.
// A pre-release (e.g. 1.0.0-beta) sorts before its corresponding release.
func CompareVersions(a, b string) int {
	coreA, preA := splitVersion(a)
	coreB, preB := splitVersion(b)

	n := max(len(coreA), len(coreB))
	for i := 0; i < n; i++ {
		var x, y int
		if i < len(coreA) {
			x = coreA[i]
		}
		if i < len(coreB) {
			y = coreB[i]
		}
		if x > y {
			return 1
		}
		if x < y {
			return -1
		}
	}

	switch {
	case preA == preB:
		return 0
	case preA == "":
		return 1
	case preB == "":
		return -1
	case preA > preB:
		return 1
	default:
		return -1
	}
}

func splitVersion(v string) ([]int, string) {
	v = normalizeVersion(v)
	if i := strings.IndexByte(v, '+'); i >= 0 {
		v = v[:i]
	}
	pre := ""
	if i := strings.IndexByte(v, '-'); i >= 0 {
		pre = v[i+1:]
		v = v[:i]
	}
	parts := strings.Split(v, ".")
	nums := make([]int, 0, len(parts))
	for _, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil {
			n = 0
		}
		nums = append(nums, n)
	}
	return nums, pre
}
