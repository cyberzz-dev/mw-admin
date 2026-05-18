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
	"sort"
	"time"

	"github.com/elastic/go-elasticsearch/v8"
)

func newESClient(cluster *models.ESCluster) (*elasticsearch.Client, error) {
	addresses := make([]string, 0, len(cluster.Nodes))
	for _, n := range cluster.Nodes {
		addresses = append(addresses, fmt.Sprintf("%s://%s:%d", cluster.Scheme, n.Host, n.Port))
	}

	cfg := elasticsearch.Config{
		Addresses: addresses,
	}
	if cluster.Username != "" {
		cfg.Username = cluster.Username
		cfg.Password = cluster.Password
	}
	return elasticsearch.NewClient(cfg)
}

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
	client, err := newESClient(cluster)
	if err != nil {
		return nil, err
	}

	res, err := client.Cat.Indices(
		client.Cat.Indices.WithContext(context.Background()),
		client.Cat.Indices.WithFormat("json"),
		client.Cat.Indices.WithH("index", "health", "status", "docs.count", "store.size", "pri", "rep"),
	)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.IsError() {
		return nil, fmt.Errorf("es error: %s", res.String())
	}

	var indices []ESIndex
	if err := json.NewDecoder(res.Body).Decode(&indices); err != nil {
		return nil, err
	}
	return indices, nil
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
	client, err := newESClient(cluster)
	if err != nil {
		return nil, err
	}

	res, err := client.Cat.Nodes(
		client.Cat.Nodes.WithContext(context.Background()),
		client.Cat.Nodes.WithFormat("json"),
		client.Cat.Nodes.WithH("name", "ip", "node.role", "load_1m", "heap.percent", "cpu"),
	)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.IsError() {
		return nil, fmt.Errorf("es error: %s", res.String())
	}

	var nodes []ESNodeInfo
	if err := json.NewDecoder(res.Body).Decode(&nodes); err != nil {
		return nil, err
	}

	// Fetch _cat/allocation and merge disk info by node name
	allocRes, allocErr := client.Cat.Allocation(
		client.Cat.Allocation.WithContext(context.Background()),
		client.Cat.Allocation.WithFormat("json"),
		client.Cat.Allocation.WithH("node", "shards", "disk.indices", "disk.used", "disk.avail", "disk.total", "disk.percent"),
	)
	if allocErr == nil {
		defer allocRes.Body.Close()
		if !allocRes.IsError() {
			var allocs []esAllocRow
			if json.NewDecoder(allocRes.Body).Decode(&allocs) == nil {
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

func ListESTemplates(cluster *models.ESCluster) ([]ESTemplate, error) {
	client, err := newESClient(cluster)
	if err != nil {
		return nil, err
	}
	res, err := client.Indices.GetIndexTemplate(
		client.Indices.GetIndexTemplate.WithContext(context.Background()),
	)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.IsError() {
		return nil, fmt.Errorf("es error: %s", res.String())
	}

	var raw struct {
		IndexTemplates []struct {
			Name          string          `json:"name"`
			IndexTemplate json.RawMessage `json:"index_template"`
		} `json:"index_templates"`
	}
	if err := json.NewDecoder(res.Body).Decode(&raw); err != nil {
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

// ESILMPolicy holds ILM policy metadata
type ESILMPolicy struct {
	Name         string          `json:"name"`
	Version      int             `json:"version"`
	ModifiedDate string          `json:"modified_date"`
	Phases       []string        `json:"phases"`
	RawJSON      json.RawMessage `json:"raw_json"`
}

func ListESILMPolicies(cluster *models.ESCluster) ([]ESILMPolicy, error) {
	client, err := newESClient(cluster)
	if err != nil {
		return nil, err
	}
	res, err := client.ILM.GetLifecycle(
		client.ILM.GetLifecycle.WithContext(context.Background()),
	)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.IsError() {
		return nil, fmt.Errorf("es error: %s", res.String())
	}

	var raw map[string]json.RawMessage
	if err := json.NewDecoder(res.Body).Decode(&raw); err != nil {
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
	client, err := newESClient(cluster)
	if err != nil {
		return err
	}
	res, err := client.Indices.Delete([]string{indexName}, client.Indices.Delete.WithContext(context.Background()))
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.IsError() {
		return fmt.Errorf("es error: %s", res.String())
	}
	return nil
}

func CloseESIndex(cluster *models.ESCluster, indexName string) error {
	client, err := newESClient(cluster)
	if err != nil {
		return err
	}
	res, err := client.Indices.Close([]string{indexName}, client.Indices.Close.WithContext(context.Background()))
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.IsError() {
		return fmt.Errorf("es error: %s", res.String())
	}
	return nil
}

func OpenESIndex(cluster *models.ESCluster, indexName string) error {
	client, err := newESClient(cluster)
	if err != nil {
		return err
	}
	res, err := client.Indices.Open([]string{indexName}, client.Indices.Open.WithContext(context.Background()))
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.IsError() {
		return fmt.Errorf("es error: %s", res.String())
	}
	return nil
}

func GetESIndexMapping(cluster *models.ESCluster, indexName string) (json.RawMessage, error) {
	client, err := newESClient(cluster)
	if err != nil {
		return nil, err
	}
	res, err := client.Indices.GetMapping(
		client.Indices.GetMapping.WithContext(context.Background()),
		client.Indices.GetMapping.WithIndex(indexName),
	)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.IsError() {
		return nil, fmt.Errorf("es error: %s", res.String())
	}
	var raw json.RawMessage
	if err := json.NewDecoder(res.Body).Decode(&raw); err != nil {
		return nil, err
	}
	return raw, nil
}

func GetESIndexSettings(cluster *models.ESCluster, indexName string) (json.RawMessage, error) {
	client, err := newESClient(cluster)
	if err != nil {
		return nil, err
	}
	res, err := client.Indices.GetSettings(
		client.Indices.GetSettings.WithContext(context.Background()),
		client.Indices.GetSettings.WithIndex(indexName),
	)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.IsError() {
		return nil, fmt.Errorf("es error: %s", res.String())
	}
	var raw json.RawMessage
	if err := json.NewDecoder(res.Body).Decode(&raw); err != nil {
		return nil, err
	}
	return raw, nil
}

func PutESIndexMapping(cluster *models.ESCluster, indexName string, body []byte) error {
	client, err := newESClient(cluster)
	if err != nil {
		return err
	}
	res, err := client.Indices.PutMapping(
		[]string{indexName},
		bytes.NewReader(body),
		client.Indices.PutMapping.WithContext(context.Background()),
	)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.IsError() {
		return fmt.Errorf("es error: %s", res.String())
	}
	return nil
}

func PutESIndexSettings(cluster *models.ESCluster, indexName string, body []byte) error {
	client, err := newESClient(cluster)
	if err != nil {
		return err
	}
	res, err := client.Indices.PutSettings(
		bytes.NewReader(body),
		client.Indices.PutSettings.WithContext(context.Background()),
		client.Indices.PutSettings.WithIndex(indexName),
	)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.IsError() {
		return fmt.Errorf("es error: %s", res.String())
	}
	return nil
}

// ---- Template operations ----

func DeleteESTemplate(cluster *models.ESCluster, name string) error {
	client, err := newESClient(cluster)
	if err != nil {
		return err
	}
	res, err := client.Indices.DeleteIndexTemplate(name, client.Indices.DeleteIndexTemplate.WithContext(context.Background()))
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.IsError() {
		return fmt.Errorf("es error: %s", res.String())
	}
	return nil
}

func PutESTemplate(cluster *models.ESCluster, name string, body []byte) error {
	client, err := newESClient(cluster)
	if err != nil {
		return err
	}
	res, err := client.Indices.PutIndexTemplate(name, bytes.NewReader(body), client.Indices.PutIndexTemplate.WithContext(context.Background()))
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.IsError() {
		return fmt.Errorf("es error: %s", res.String())
	}
	return nil
}

// ---- ILM operations ----

func DeleteESILMPolicy(cluster *models.ESCluster, name string) error {
	client, err := newESClient(cluster)
	if err != nil {
		return err
	}
	res, err := client.ILM.DeleteLifecycle(name, client.ILM.DeleteLifecycle.WithContext(context.Background()))
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.IsError() {
		return fmt.Errorf("es error: %s", res.String())
	}
	return nil
}

func PutESILMPolicy(cluster *models.ESCluster, name string, body []byte) error {
	client, err := newESClient(cluster)
	if err != nil {
		return err
	}
	res, err := client.ILM.PutLifecycle(name, client.ILM.PutLifecycle.WithBody(bytes.NewReader(body)), client.ILM.PutLifecycle.WithContext(context.Background()))
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.IsError() {
		return fmt.Errorf("es error: %s", res.String())
	}
	return nil
}

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
	node := cluster.Nodes[0]
	scheme := cluster.Scheme
	if scheme == "" {
		scheme = "http"
	}
	if path == "" {
		path = "/"
	} else if path[0] != '/' {
		path = "/" + path
	}
	fullURL := fmt.Sprintf("%s://%s:%d%s", scheme, node.Host, node.Port, path)

	var bodyReader io.Reader
	if len(body) > 0 {
		bodyReader = bytes.NewReader(body)
	}

	req, err := http.NewRequestWithContext(context.Background(), method, fullURL, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	if cluster.Username != "" {
		req.SetBasicAuth(cluster.Username, cluster.Password)
	}
	if bodyReader != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")

	transport := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, // #nosec G402 — admin tool, user controls cluster
	}
	httpClient := &http.Client{Timeout: 30 * time.Second, Transport: transport}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
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
