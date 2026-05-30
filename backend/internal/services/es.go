package services

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"mw-admin/internal/models"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ---- HTTP helper ----

var (
	esHTTPClient     *http.Client
	esHTTPClientOnce sync.Once
	esNodeCounter    sync.Map // map[uint]*atomic.Uint64 — round-robin index per cluster
)

// esPickNodeIndex returns the starting node index for this request using
// per-cluster atomic round-robin, so requests are evenly spread across nodes.
func esPickNodeIndex(clusterID uint, total int) int {
	val, _ := esNodeCounter.LoadOrStore(clusterID, new(atomic.Uint64))
	return int(val.(*atomic.Uint64).Add(1)-1) % total
}

func getHTTPClient() *http.Client {
	esHTTPClientOnce.Do(func() {
		esHTTPClient = &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, // #nosec G402 — admin tool
			},
		}
	})
	return esHTTPClient
}

// esDoRaw sends method+path to an ES cluster node.
// It uses per-cluster atomic round-robin to pick the starting node, then
// falls back to the remaining nodes in order if a connection error occurs.
// The request body is buffered upfront so it can be replayed on retry.
func esDoRaw(cluster *models.ESCluster, method, path string, body io.Reader) (*http.Response, []byte, error) {
	if len(cluster.Nodes) == 0 {
		return nil, nil, fmt.Errorf("cluster has no nodes configured")
	}
	scheme := cluster.Scheme
	if scheme == "" {
		scheme = "http"
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}

	// Buffer body so it can be replayed on each retry attempt.
	var bodyBuf []byte
	if body != nil {
		var err error
		bodyBuf, err = io.ReadAll(body)
		if err != nil {
			return nil, nil, fmt.Errorf("read request body: %w", err)
		}
	}

	startIdx := esPickNodeIndex(cluster.ID, len(cluster.Nodes))
	var lastErr error
	for i := 0; i < len(cluster.Nodes); i++ {
		n := cluster.Nodes[(startIdx+i)%len(cluster.Nodes)]
		base := fmt.Sprintf("%s://%s:%d", scheme, n.Host, n.Port)

		var bodyReader io.Reader
		if bodyBuf != nil {
			bodyReader = bytes.NewReader(bodyBuf)
		}
		req, err := http.NewRequestWithContext(context.Background(), method, base+path, bodyReader)
		if err != nil {
			lastErr = fmt.Errorf("build request to %s:%d: %w", n.Host, n.Port, err)
			continue
		}
		if cluster.Username != "" {
			req.SetBasicAuth(cluster.Username, cluster.Password)
		}
		if bodyBuf != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		req.Header.Set("Accept", "application/json")

		resp, err := getHTTPClient().Do(req)
		if err != nil {
			lastErr = fmt.Errorf("node %s:%d unreachable: %w", n.Host, n.Port, err)
			continue // network error — try next node
		}
		respBytes, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			lastErr = fmt.Errorf("read response from %s:%d: %w", n.Host, n.Port, readErr)
			continue
		}
		return resp, respBytes, nil
	}
	return nil, nil, fmt.Errorf("all nodes failed, last error: %w", lastErr)
}

func esDo(cluster *models.ESCluster, method, path string, body io.Reader) (*http.Response, []byte, error) {
	resp, respBytes, err := esDoRaw(cluster, method, path, body)
	if err != nil {
		return nil, nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, nil, fmt.Errorf("es error [%d]: %s", resp.StatusCode, string(respBytes))
	}
	return resp, respBytes, nil
}

func esGetJSON(cluster *models.ESCluster, path string, dst interface{}) error {
	_, body, err := esDo(cluster, "GET", path, nil)
	if err != nil {
		return err
	}
	return json.Unmarshal(body, dst)
}

type esVersion struct {
	Major int
	Minor int
}

func detectESVersion(cluster *models.ESCluster) (esVersion, error) {
	var info struct {
		Version struct {
			Number string `json:"number"`
		} `json:"version"`
	}
	if err := esGetJSON(cluster, "/", &info); err != nil {
		return esVersion{}, err
	}
	parts := strings.SplitN(info.Version.Number, ".", 3)
	v := esVersion{}
	if len(parts) >= 1 {
		fmt.Sscanf(parts[0], "%d", &v.Major)
	}
	if len(parts) >= 2 {
		fmt.Sscanf(parts[1], "%d", &v.Minor)
	}
	return v, nil
}

func (v esVersion) supportsComposableTemplates() bool {
	return v.Major > 7 || (v.Major == 7 && v.Minor >= 8)
}

// ---- ES types ----

// ESIndex holds index metadata
type ESIndex struct {
	Index     string `json:"index"`
	Health    string `json:"health"`
	Status    string `json:"status"`
	DocsCount string `json:"docs.count"`
	StoreSize string `json:"store.size"`
	Primaries string `json:"pri"`
	Replicas  string `json:"rep"`
}

func ListESIndices(cluster *models.ESCluster) ([]ESIndex, error) {
	var indices []ESIndex
	err := esGetJSON(cluster,
		"/_cat/indices?format=json&h=index,health,status,docs.count,store.size,pri,rep",
		&indices)
	return indices, err
}

// ESNodeInfo holds node information
type ESNodeInfo struct {
	Name        string `json:"name"`
	IP          string `json:"ip"`
	Role        string `json:"node.role"`
	Load1m      string `json:"load_1m"`
	HeapPerc    string `json:"heap.percent"`
	CPU         string `json:"cpu"`
	Shards      string `json:"shards"`
	DiskIndices string `json:"disk.indices"`
	DiskUsed    string `json:"disk.used"`
	DiskAvail   string `json:"disk.avail"`
	DiskTotal   string `json:"disk.total"`
	DiskPercent string `json:"disk.percent"`
}

type esAllocRow struct {
	Node        string `json:"node"`
	Shards      string `json:"shards"`
	DiskIndices string `json:"disk.indices"`
	DiskUsed    string `json:"disk.used"`
	DiskAvail   string `json:"disk.avail"`
	DiskTotal   string `json:"disk.total"`
	DiskPercent string `json:"disk.percent"`
}

func ListESNodes(cluster *models.ESCluster) ([]ESNodeInfo, error) {
	var nodes []ESNodeInfo
	if err := esGetJSON(cluster,
		"/_cat/nodes?format=json&h=name,ip,node.role,load_1m,heap.percent,cpu",
		&nodes); err != nil {
		return nil, err
	}

	// Fetch _cat/allocation and merge disk info by node name
	var allocs []esAllocRow
	if err := esGetJSON(cluster,
		"/_cat/allocation?format=json&h=node,shards,disk.indices,disk.used,disk.avail,disk.total,disk.percent",
		&allocs); err == nil {
		allocMap := make(map[string]esAllocRow, len(allocs))
		for _, a := range allocs {
			allocMap[a.Node] = a
		}
		for i, n := range nodes {
			if a, ok := allocMap[n.Name]; ok {
				nodes[i].Shards = a.Shards
				nodes[i].DiskIndices = a.DiskIndices
				nodes[i].DiskUsed = a.DiskUsed
				nodes[i].DiskAvail = a.DiskAvail
				nodes[i].DiskTotal = a.DiskTotal
				nodes[i].DiskPercent = a.DiskPercent
			}
		}
	}
	return nodes, nil
}

// ESTemplate holds index template metadata
type ESTemplate struct {
	Name          string          `json:"name"`
	IndexPatterns []string        `json:"index_patterns"`
	ComposedOf    []string        `json:"composed_of"`
	Priority      int             `json:"priority"`
	Version       int             `json:"version"`
	RawJSON       json.RawMessage `json:"raw_json"`
}

// ListESTemplates detects ES version and uses the appropriate template API:
// - ES >= 7.8: uses _index_template (composable templates)
// - ES < 7.8:  uses _template (legacy templates)
func ListESTemplates(cluster *models.ESCluster) ([]ESTemplate, error) {
	ver, verErr := detectESVersion(cluster)
	if verErr == nil {
		if ver.supportsComposableTemplates() {
			return listComposableTemplates(cluster)
		}
		return listLegacyTemplates(cluster)
	}
	// Fall back: try composable first, if version detection fails
	templates, err := listComposableTemplates(cluster)
	if err != nil {
		return listLegacyTemplates(cluster)
	}
	return templates, nil
}

func listComposableTemplates(cluster *models.ESCluster) ([]ESTemplate, error) {
	var raw struct {
		IndexTemplates []struct {
			Name          string          `json:"name"`
			IndexTemplate json.RawMessage `json:"index_template"`
		} `json:"index_templates"`
	}
	if err := esGetJSON(cluster, "/_index_template", &raw); err != nil {
		return nil, err
	}
	templates := make([]ESTemplate, 0, len(raw.IndexTemplates))
	for _, t := range raw.IndexTemplates {
		var tpl struct {
			IndexPatterns []string `json:"index_patterns"`
			ComposedOf    []string `json:"composed_of"`
			Priority      int      `json:"priority"`
			Version       int      `json:"version"`
		}
		_ = json.Unmarshal(t.IndexTemplate, &tpl)
		templates = append(templates, ESTemplate{
			Name:          t.Name,
			IndexPatterns: tpl.IndexPatterns,
			ComposedOf:    tpl.ComposedOf,
			Priority:      tpl.Priority,
			Version:       tpl.Version,
			RawJSON:       t.IndexTemplate,
		})
	}
	sort.Slice(templates, func(i, j int) bool { return templates[i].Name < templates[j].Name })
	return templates, nil
}

func listLegacyTemplates(cluster *models.ESCluster) ([]ESTemplate, error) {
	var raw map[string]json.RawMessage
	if err := esGetJSON(cluster, "/_template", &raw); err != nil {
		return nil, err
	}
	templates := make([]ESTemplate, 0, len(raw))
	for name, rawBytes := range raw {
		var tpl struct {
			IndexPatterns []string `json:"index_patterns"`
			Order         int      `json:"order"`
			Version       int      `json:"version"`
		}
		_ = json.Unmarshal(rawBytes, &tpl)
		templates = append(templates, ESTemplate{
			Name:          name,
			IndexPatterns: tpl.IndexPatterns,
			Priority:      tpl.Order,
			Version:       tpl.Version,
			RawJSON:       rawBytes,
		})
	}
	sort.Slice(templates, func(i, j int) bool { return templates[i].Name < templates[j].Name })
	return templates, nil
}

// ---- Component Template operations ----

// ESComponentTemplate holds component template metadata
type ESComponentTemplate struct {
	Name    string          `json:"name"`
	Version int             `json:"version"`
	RawJSON json.RawMessage `json:"raw_json"`
}

// ListESComponentTemplates fetches all component templates via /_component_template.
func ListESComponentTemplates(cluster *models.ESCluster) ([]ESComponentTemplate, error) {
	var raw struct {
		ComponentTemplates []struct {
			Name              string          `json:"name"`
			ComponentTemplate json.RawMessage `json:"component_template"`
		} `json:"component_templates"`
	}
	if err := esGetJSON(cluster, "/_component_template", &raw); err != nil {
		return nil, err
	}
	templates := make([]ESComponentTemplate, 0, len(raw.ComponentTemplates))
	for _, t := range raw.ComponentTemplates {
		var ct struct {
			Version int `json:"version"`
		}
		_ = json.Unmarshal(t.ComponentTemplate, &ct)
		templates = append(templates, ESComponentTemplate{
			Name:    t.Name,
			Version: ct.Version,
			RawJSON: t.ComponentTemplate,
		})
	}
	sort.Slice(templates, func(i, j int) bool { return templates[i].Name < templates[j].Name })
	return templates, nil
}

// DeleteESComponentTemplate deletes a single component template.
func DeleteESComponentTemplate(cluster *models.ESCluster, name string) error {
	_, _, err := esDo(cluster, "DELETE", "/_component_template/"+url.PathEscape(name), nil)
	return err
}

// PutESComponentTemplate creates or updates a component template.
func PutESComponentTemplate(cluster *models.ESCluster, name string, bodyBytes []byte) error {
	_, _, err := esDo(cluster, "PUT", "/_component_template/"+url.PathEscape(name), bytes.NewReader(bodyBytes))
	return err
}

// ---- ILM policies ----

// ESILMPolicy holds ILM policy metadata
type ESILMPolicy struct {
	Name         string          `json:"name"`
	Version      int             `json:"version"`
	ModifiedDate string          `json:"modified_date"`
	Phases       []string        `json:"phases"`
	RawJSON      json.RawMessage `json:"raw_json"`
}

func ListESILMPolicies(cluster *models.ESCluster) ([]ESILMPolicy, error) {
	var raw map[string]json.RawMessage
	if err := esGetJSON(cluster, "/_ilm/policy", &raw); err != nil {
		return nil, err
	}
	policies := make([]ESILMPolicy, 0, len(raw))
	for name, rawBytes := range raw {
		var p struct {
			Version      int    `json:"version"`
			ModifiedDate string `json:"modified_date"`
			Policy       struct {
				Phases map[string]json.RawMessage `json:"phases"`
			} `json:"policy"`
		}
		if err := json.Unmarshal(rawBytes, &p); err != nil {
			continue
		}
		phases := make([]string, 0, len(p.Policy.Phases))
		for phase := range p.Policy.Phases {
			phases = append(phases, phase)
		}
		sort.Strings(phases)
		policies = append(policies, ESILMPolicy{
			Name:         name,
			Version:      p.Version,
			ModifiedDate: p.ModifiedDate,
			Phases:       phases,
			RawJSON:      rawBytes,
		})
	}
	sort.Slice(policies, func(i, j int) bool { return policies[i].Name < policies[j].Name })
	return policies, nil
}

// ---- Index operations ----

func DeleteESIndex(cluster *models.ESCluster, indexName string) error {
	_, _, err := esDo(cluster, "DELETE", "/"+url.PathEscape(indexName), nil)
	return err
}

func CloseESIndex(cluster *models.ESCluster, indexName string) error {
	_, _, err := esDo(cluster, "POST", "/"+url.PathEscape(indexName)+"/_close", nil)
	return err
}

func OpenESIndex(cluster *models.ESCluster, indexName string) error {
	_, _, err := esDo(cluster, "POST", "/"+url.PathEscape(indexName)+"/_open", nil)
	return err
}

func GetESIndexMapping(cluster *models.ESCluster, indexName string) (json.RawMessage, error) {
	_, body, err := esDo(cluster, "GET", "/"+url.PathEscape(indexName)+"/_mapping", nil)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(body), nil
}

func GetESIndexSettings(cluster *models.ESCluster, indexName string) (json.RawMessage, error) {
	_, body, err := esDo(cluster, "GET", "/"+url.PathEscape(indexName)+"/_settings", nil)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(body), nil
}

func PutESIndexMapping(cluster *models.ESCluster, indexName string, bodyBytes []byte) error {
	_, _, err := esDo(cluster, "PUT", "/"+url.PathEscape(indexName)+"/_mapping", bytes.NewReader(bodyBytes))
	return err
}

func PutESIndexSettings(cluster *models.ESCluster, indexName string, bodyBytes []byte) error {
	_, _, err := esDo(cluster, "PUT", "/"+url.PathEscape(indexName)+"/_settings", bytes.NewReader(bodyBytes))
	return err
}

// ---- Template operations ----

// DeleteESTemplate deletes a template. Tries composable first, then legacy.
func DeleteESTemplate(cluster *models.ESCluster, name string) error {
	ver, verErr := detectESVersion(cluster)
	if verErr == nil {
		if ver.supportsComposableTemplates() {
			_, _, err := esDo(cluster, "DELETE", "/_index_template/"+url.PathEscape(name), nil)
			return err
		}
		_, _, err := esDo(cluster, "DELETE", "/_template/"+url.PathEscape(name), nil)
		return err
	}
	// Try composable first, fall back to legacy if version detection fails
	_, _, err := esDo(cluster, "DELETE", "/_index_template/"+url.PathEscape(name), nil)
	if err != nil {
		_, _, err = esDo(cluster, "DELETE", "/_template/"+url.PathEscape(name), nil)
	}
	return err
}

// PutESTemplate creates/updates a template. Uses composable for ES >= 7.8, legacy otherwise.
func PutESTemplate(cluster *models.ESCluster, name string, bodyBytes []byte) error {
	ver, verErr := detectESVersion(cluster)
	if verErr == nil && ver.supportsComposableTemplates() {
		_, _, err := esDo(cluster, "PUT", "/_index_template/"+url.PathEscape(name), bytes.NewReader(bodyBytes))
		return err
	}
	// Default to legacy template for older ES
	_, _, err := esDo(cluster, "PUT", "/_template/"+url.PathEscape(name), bytes.NewReader(bodyBytes))
	return err
}

// ---- ILM operations ----

func DeleteESILMPolicy(cluster *models.ESCluster, name string) error {
	_, _, err := esDo(cluster, "DELETE", "/_ilm/policy/"+url.PathEscape(name), nil)
	return err
}

func PutESILMPolicy(cluster *models.ESCluster, name string, bodyBytes []byte) error {
	_, _, err := esDo(cluster, "PUT", "/_ilm/policy/"+url.PathEscape(name), bytes.NewReader(bodyBytes))
	return err
}

// ---- Dev Console ----

// ESDevConsoleResult holds the raw ES response for dev console
type ESDevConsoleResult struct {
	StatusCode int             `json:"status_code"`
	Body       json.RawMessage `json:"body"`
}

// ESDevConsole proxies a raw HTTP request to the ES cluster and returns the response.
func ESDevConsole(cluster *models.ESCluster, method, path string, body []byte) (*ESDevConsoleResult, error) {
	if len(cluster.Nodes) == 0 {
		return nil, fmt.Errorf("cluster has no nodes configured")
	}
	if path == "" {
		path = "/"
	} else if path[0] != '/' {
		path = "/" + path
	}

	var bodyReader io.Reader
	if len(body) > 0 {
		bodyReader = bytes.NewReader(body)
	}

	resp, respBytes, err := esDoRaw(cluster, method, path, bodyReader)
	if err != nil {
		return nil, err
	}

	var raw json.RawMessage
	if json.Valid(respBytes) {
		raw = json.RawMessage(respBytes)
	} else {
		quoted, _ := json.Marshal(string(respBytes))
		raw = json.RawMessage(quoted)
	}

	return &ESDevConsoleResult{
		StatusCode: resp.StatusCode,
		Body:       raw,
	}, nil
}
