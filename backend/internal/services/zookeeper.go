package services

import (
	"encoding/json"
	"fmt"
	"io"
	"mw-admin/internal/models"
	"net"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-zookeeper/zk"
)

const zkTimeout = 8 * time.Second

// newZKConn dials a ZooKeeper cluster and applies auth if configured.
// For SASL clusters it delegates to the custom SASL client (zk_sasl.go) which
// implements the proper opcode-200 SASL handshake.
func newZKConn(cluster *models.ZKCluster) (zkConn, error) {
	if cluster.AuthScheme == "sasl" {
		return newSASLZKConn(cluster)
	}

	servers := strings.Split(cluster.Servers, ",")
	for i := range servers {
		servers[i] = strings.TrimSpace(servers[i])
	}

	conn, _, err := zk.Connect(servers, zkTimeout, zk.WithLogger(zk.DefaultLogger))
	if err != nil {
		return nil, fmt.Errorf("connect failed: %w", err)
	}

	if cluster.AuthScheme == "digest" && cluster.Username != "" {
		auth := cluster.Username + ":" + cluster.Password
		if addErr := conn.AddAuth("digest", []byte(auth)); addErr != nil {
			conn.Close()
			return nil, fmt.Errorf("digest auth failed: %w", addErr)
		}
	}
	return conn, nil
}

// ---- Types ----

// ZKListResult holds a paginated list of children for a znode path.
type ZKListResult struct {
	Children []string `json:"children"`
	Total    int      `json:"total"`
	Offset   int      `json:"offset"`
	Limit    int      `json:"limit"`
}

// ZKStat holds ZooKeeper stat metadata.
type ZKStat struct {
	Czxid          int64 `json:"czxid"`
	Mzxid          int64 `json:"mzxid"`
	Ctime          int64 `json:"ctime"`
	Mtime          int64 `json:"mtime"`
	Version        int32 `json:"version"`
	Cversion       int32 `json:"cversion"`
	Aversion       int32 `json:"aversion"`
	EphemeralOwner int64 `json:"ephemeral_owner"`
	DataLength     int32 `json:"data_length"`
	NumChildren    int32 `json:"num_children"`
	Pzxid          int64 `json:"pzxid"`
}

// ZKACL represents a single ZooKeeper ACL entry.
type ZKACL struct {
	Scheme   string `json:"scheme"`
	ID       string `json:"id"`
	Perms    int32  `json:"perms"`
	PermsStr string `json:"perms_str"`
}

// ZKNodeInfo bundles a znode's data, stat, and ACLs.
type ZKNodeInfo struct {
	Path   string  `json:"path"`
	Data   string  `json:"data"`
	IsJSON bool    `json:"is_json"`
	Stat   *ZKStat `json:"stat"`
	ACLs   []ZKACL `json:"acls"`
}

// ZKStats holds server-level monitoring data from the ZooKeeper mntr command.
type ZKStats struct {
	Version         string `json:"version"`
	WatchCount      int64  `json:"watch_count"`
	ZnodeCount      int64  `json:"znode_count"`
	Connections     int64  `json:"connections"`
	AvgLatency      int64  `json:"avg_latency"`
	MaxLatency      int64  `json:"max_latency"`
	MinLatency      int64  `json:"min_latency"`
	OutstandingReqs int64  `json:"outstanding_requests"`
}

// ZKCreateRequest is the body for creating a new znode.
type ZKCreateRequest struct {
	Path  string  `json:"path"`
	Data  string  `json:"data"`
	Flags int32   `json:"flags"`
	ACLs  []ZKACL `json:"acls"`
}

// ---- Helpers ----

func permsToString(perms int32) string {
	var parts []string
	if perms&zk.PermRead != 0 {
		parts = append(parts, "r")
	}
	if perms&zk.PermWrite != 0 {
		parts = append(parts, "w")
	}
	if perms&zk.PermCreate != 0 {
		parts = append(parts, "c")
	}
	if perms&zk.PermDelete != 0 {
		parts = append(parts, "d")
	}
	if perms&zk.PermAdmin != 0 {
		parts = append(parts, "a")
	}
	return strings.Join(parts, "")
}

func convertStat(s *zk.Stat) *ZKStat {
	return &ZKStat{
		Czxid:          s.Czxid,
		Mzxid:          s.Mzxid,
		Ctime:          s.Ctime,
		Mtime:          s.Mtime,
		Version:        s.Version,
		Cversion:       s.Cversion,
		Aversion:       s.Aversion,
		EphemeralOwner: s.EphemeralOwner,
		DataLength:     s.DataLength,
		NumChildren:    s.NumChildren,
		Pzxid:          s.Pzxid,
	}
}

func convertACLs(acls []zk.ACL) []ZKACL {
	out := make([]ZKACL, len(acls))
	for i, a := range acls {
		out[i] = ZKACL{Scheme: a.Scheme, ID: a.ID, Perms: a.Perms, PermsStr: permsToString(a.Perms)}
	}
	return out
}

// ---- Service functions ----

// ZKListChildren returns sorted, paginated children of a znode.
func ZKListChildren(cluster *models.ZKCluster, path string, offset, limit int) (*ZKListResult, error) {
	conn, err := newZKConn(cluster)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	children, _, err := conn.Children(path)
	if err != nil {
		return nil, fmt.Errorf("list children of %q: %w", path, err)
	}

	total := len(children)
	sort.Strings(children)

	if offset >= total {
		return &ZKListResult{Children: []string{}, Total: total, Offset: offset, Limit: limit}, nil
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return &ZKListResult{Children: children[offset:end], Total: total, Offset: offset, Limit: limit}, nil
}

// ZKGetNode fetches data, stat, and ACLs for a znode.
func ZKGetNode(cluster *models.ZKCluster, path string) (*ZKNodeInfo, error) {
	conn, err := newZKConn(cluster)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	data, stat, err := conn.Get(path)
	if err != nil {
		return nil, fmt.Errorf("get %q: %w", path, err)
	}
	acls, _, err := conn.GetACL(path)
	if err != nil {
		return nil, fmt.Errorf("get ACL for %q: %w", path, err)
	}

	dataStr := string(data)
	isJSON := len(data) > 0 && json.Valid(data)

	return &ZKNodeInfo{
		Path:   path,
		Data:   dataStr,
		IsJSON: isJSON,
		Stat:   convertStat(stat),
		ACLs:   convertACLs(acls),
	}, nil
}

// ZKSetNodeData sets the data of a znode. Pass version=-1 to skip the version check.
func ZKSetNodeData(cluster *models.ZKCluster, path, data string, version int32) error {
	conn, err := newZKConn(cluster)
	if err != nil {
		return err
	}
	defer conn.Close()

	if _, err = conn.Set(path, []byte(data), version); err != nil {
		return fmt.Errorf("set %q: %w", path, err)
	}
	return nil
}

// ZKCreateNode creates a new znode.
func ZKCreateNode(cluster *models.ZKCluster, req *ZKCreateRequest) (string, error) {
	conn, err := newZKConn(cluster)
	if err != nil {
		return "", err
	}
	defer conn.Close()

	acls := zk.WorldACL(zk.PermAll)
	if len(req.ACLs) > 0 {
		acls = make([]zk.ACL, len(req.ACLs))
		for i, a := range req.ACLs {
			acls[i] = zk.ACL{Scheme: a.Scheme, ID: a.ID, Perms: a.Perms}
		}
	}

	created, err := conn.Create(req.Path, []byte(req.Data), req.Flags, acls)
	if err != nil {
		return "", fmt.Errorf("create %q: %w", req.Path, err)
	}
	return created, nil
}

// ZKDeleteNode deletes a znode. Pass version=-1 to skip the version check.
func ZKDeleteNode(cluster *models.ZKCluster, path string, version int32) error {
	conn, err := newZKConn(cluster)
	if err != nil {
		return err
	}
	defer conn.Close()

	if err := conn.Delete(path, version); err != nil {
		return fmt.Errorf("delete %q: %w", path, err)
	}
	return nil
}

// deleteRecursive deletes path and all its descendants using an existing connection.
func deleteRecursive(conn zkConn, path string) error {
	children, _, err := conn.Children(path)
	if err != nil {
		return fmt.Errorf("list children of %q: %w", path, err)
	}
	for _, child := range children {
		var childPath string
		if path == "/" {
			childPath = "/" + child
		} else {
			childPath = path + "/" + child
		}
		if err := deleteRecursive(conn, childPath); err != nil {
			return err
		}
	}
	return conn.Delete(path, -1)
}

// ZKDeleteNodeRecursive deletes a znode and all its descendants.
func ZKDeleteNodeRecursive(cluster *models.ZKCluster, path string) error {
	conn, err := newZKConn(cluster)
	if err != nil {
		return err
	}
	defer conn.Close()
	return deleteRecursive(conn, path)
}

// ZKSetACL replaces the ACL on a znode.
func ZKSetACL(cluster *models.ZKCluster, path string, acls []ZKACL, version int32) error {
	conn, err := newZKConn(cluster)
	if err != nil {
		return err
	}
	defer conn.Close()

	zkAcls := make([]zk.ACL, len(acls))
	for i, a := range acls {
		zkAcls[i] = zk.ACL{Scheme: a.Scheme, ID: a.ID, Perms: a.Perms}
	}
	if _, err = conn.SetACL(path, zkAcls, version); err != nil {
		return fmt.Errorf("set ACL for %q: %w", path, err)
	}
	return nil
}

// ZKGetStats fetches server-level statistics by sending the "mntr" four-letter
// command over a raw TCP connection to the first server in the cluster list.
// The four-letter commands bypass ZK session authentication and work independently
// of the cluster auth scheme (digest/sasl/none).
func ZKGetStats(cluster *models.ZKCluster) (*ZKStats, error) {
	server := strings.TrimSpace(strings.SplitN(cluster.Servers, ",", 2)[0])
	conn, err := net.DialTimeout("tcp", server, 5*time.Second)
	if err != nil {
		return nil, fmt.Errorf("dial %s: %w", server, err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(5 * time.Second)) //nolint:errcheck

	if _, err = conn.Write([]byte("mntr\n")); err != nil {
		return nil, fmt.Errorf("send mntr: %w", err)
	}

	raw, err := io.ReadAll(conn)
	if err != nil {
		return nil, fmt.Errorf("read mntr: %w", err)
	}

	resp := string(raw)
	if strings.HasPrefix(resp, "mntr is not executed") || strings.HasPrefix(resp, "stat is not whitelisted") {
		return nil, fmt.Errorf("mntr command not whitelisted on server (add mntr to 4lw.commands.whitelist)")
	}

	stats := &ZKStats{}
	for _, line := range strings.Split(resp, "\n") {
		parts := strings.SplitN(line, "\t", 2)
		if len(parts) != 2 {
			continue
		}
		key, val := strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
		n, _ := strconv.ParseInt(val, 10, 64)
		switch key {
		case "zk_version":
			stats.Version = val
		case "zk_watch_count":
			stats.WatchCount = n
		case "zk_znode_count":
			stats.ZnodeCount = n
		case "zk_num_alive_connections":
			stats.Connections = n
		case "zk_avg_latency":
			stats.AvgLatency = n
		case "zk_max_latency":
			stats.MaxLatency = n
		case "zk_min_latency":
			stats.MinLatency = n
		case "zk_outstanding_requests":
			stats.OutstandingReqs = n
		}
	}
	return stats, nil
}
