package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"mw-admin/internal/config"
	"mw-admin/internal/models"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// ---- Consul HTTP primitives ----

type consulCheck struct {
	TCP                            string `json:"TCP,omitempty"`
	Interval                       string `json:"Interval,omitempty"`
	Timeout                        string `json:"Timeout,omitempty"`
	DeregisterCriticalServiceAfter string `json:"DeregisterCriticalServiceAfter,omitempty"`
}

type consulPayload struct {
	ID      string       `json:"ID"`
	Name    string       `json:"Name"`
	Tags    []string     `json:"Tags"`
	Address string       `json:"Address"`
	Port    int          `json:"Port"`
	Check   *consulCheck `json:"Check,omitempty"`
}

var consulHTTPClient = &http.Client{Timeout: 5 * time.Second}

func consulBaseURL() string {
	addr := config.Global.Consul.Addr
	if strings.HasPrefix(addr, "http://") || strings.HasPrefix(addr, "https://") {
		return strings.TrimRight(addr, "/")
	}
	return "http://" + addr
}

func consulRegisterSvc(svc consulPayload) error {
	body, err := json.Marshal(svc)
	if err != nil {
		return err
	}
	rawURL := consulBaseURL() + "/v1/agent/service/register"
	req, err := http.NewRequestWithContext(context.Background(), "PUT", rawURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if t := config.Global.Consul.Token; t != "" {
		req.Header.Set("X-Consul-Token", t) // #nosec G401 — token from config, not from user input
	}
	if dc := config.Global.Consul.DC; dc != "" {
		q := req.URL.Query()
		q.Set("dc", dc)
		req.URL.RawQuery = q.Encode()
	}
	resp, err := consulHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("consul register returned status %d", resp.StatusCode)
	}
	return nil
}

func consulDeregisterSvc(serviceID string) error {
	rawURL := consulBaseURL() + "/v1/agent/service/deregister/" + serviceID
	req, err := http.NewRequestWithContext(context.Background(), "PUT", rawURL, nil)
	if err != nil {
		return err
	}
	if t := config.Global.Consul.Token; t != "" {
		req.Header.Set("X-Consul-Token", t) // #nosec G401
	}
	if dc := config.Global.Consul.DC; dc != "" {
		q := req.URL.Query()
		q.Set("dc", dc)
		req.URL.RawQuery = q.Encode()
	}
	resp, err := consulHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("consul deregister returned status %d", resp.StatusCode)
	}
	return nil
}

func tcpCheck(host string, port int) *consulCheck {
	if port <= 0 {
		return nil
	}
	return &consulCheck{
		TCP:                            fmt.Sprintf("%s:%d", host, port),
		Interval:                       "15s",
		Timeout:                        "3s",
		DeregisterCriticalServiceAfter: "2m",
	}
}

func consulEnabled() bool {
	return config.Global != nil && config.Global.Consul.Enabled
}

// ---- Kafka ----

func kafkaMainServiceID(clusterID uint, host string, port int) string {
	return fmt.Sprintf("mw-kafka-%d-%s-%d", clusterID, host, port)
}

func kafkaMetricServiceID(clusterID uint, host string, metricPort int) string {
	return fmt.Sprintf("mw-kafka-metrics-%d-%s-%d", clusterID, host, metricPort)
}

// RegisterKafkaCluster registers every broker node (main port + metric port) in Consul.
// Errors are collected and returned as a combined error; Consul not reachable = non-fatal in callers.
func RegisterKafkaCluster(cluster *models.KafkaCluster) error {
	if !consulEnabled() {
		return nil
	}
	var errs []string
	for _, node := range cluster.Nodes {
		if err := consulRegisterSvc(consulPayload{
			ID:      kafkaMainServiceID(cluster.ID, node.Host, node.Port),
			Name:    cluster.Name + "-kafka",
			Tags:    []string{"kafka", "mw-admin", cluster.Name},
			Address: node.Host,
			Port:    node.Port,
			Check:   tcpCheck(node.Host, node.Port),
		}); err != nil {
			errs = append(errs, fmt.Sprintf("%s:%d main: %v", node.Host, node.Port, err))
		}
		if cluster.MetricPort > 0 {
			if err := consulRegisterSvc(consulPayload{
				ID:      kafkaMetricServiceID(cluster.ID, node.Host, cluster.MetricPort),
				Name:    cluster.Name + "-kafka-metrics",
				Tags:    []string{"kafka", "metrics", "mw-admin", cluster.Name},
				Address: node.Host,
				Port:    cluster.MetricPort,
				Check:   tcpCheck(node.Host, cluster.MetricPort),
			}); err != nil {
				errs = append(errs, fmt.Sprintf("%s:%d metric: %v", node.Host, cluster.MetricPort, err))
			}
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf(strings.Join(errs, "; "))
	}
	return nil
}

// DeregisterKafkaCluster removes all Consul service entries for the cluster.
func DeregisterKafkaCluster(cluster *models.KafkaCluster) {
	if !consulEnabled() {
		return
	}
	for _, node := range cluster.Nodes {
		if err := consulDeregisterSvc(kafkaMainServiceID(cluster.ID, node.Host, node.Port)); err != nil {
			log.Printf("[consul] deregister kafka main %s:%d: %v", node.Host, node.Port, err)
		}
		if cluster.MetricPort > 0 {
			if err := consulDeregisterSvc(kafkaMetricServiceID(cluster.ID, node.Host, cluster.MetricPort)); err != nil {
				log.Printf("[consul] deregister kafka metric %s:%d: %v", node.Host, cluster.MetricPort, err)
			}
		}
	}
}

// ---- Elasticsearch ----

func esMainServiceID(clusterID uint, host string, port int) string {
	return fmt.Sprintf("mw-es-%d-%s-%d", clusterID, host, port)
}

func esMetricServiceID(clusterID uint, host string, metricPort int) string {
	return fmt.Sprintf("mw-es-metrics-%d-%s-%d", clusterID, host, metricPort)
}

// RegisterESCluster registers every ES node (main port + metric port) in Consul.
func RegisterESCluster(cluster *models.ESCluster) error {
	if !consulEnabled() {
		return nil
	}
	var errs []string
	for _, node := range cluster.Nodes {
		if err := consulRegisterSvc(consulPayload{
			ID:      esMainServiceID(cluster.ID, node.Host, node.Port),
			Name:    cluster.Name + "-es",
			Tags:    []string{"elasticsearch", "mw-admin", cluster.Name},
			Address: node.Host,
			Port:    node.Port,
			Check:   tcpCheck(node.Host, node.Port),
		}); err != nil {
			errs = append(errs, fmt.Sprintf("%s:%d main: %v", node.Host, node.Port, err))
		}
		if cluster.MetricPort > 0 {
			if err := consulRegisterSvc(consulPayload{
				ID:      esMetricServiceID(cluster.ID, node.Host, cluster.MetricPort),
				Name:    cluster.Name + "-es-metrics",
				Tags:    []string{"elasticsearch", "metrics", "mw-admin", cluster.Name},
				Address: node.Host,
				Port:    cluster.MetricPort,
				Check:   tcpCheck(node.Host, cluster.MetricPort),
			}); err != nil {
				errs = append(errs, fmt.Sprintf("%s:%d metric: %v", node.Host, cluster.MetricPort, err))
			}
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf(strings.Join(errs, "; "))
	}
	return nil
}

// DeregisterESCluster removes all Consul service entries for the ES cluster.
func DeregisterESCluster(cluster *models.ESCluster) {
	if !consulEnabled() {
		return
	}
	for _, node := range cluster.Nodes {
		if err := consulDeregisterSvc(esMainServiceID(cluster.ID, node.Host, node.Port)); err != nil {
			log.Printf("[consul] deregister es main %s:%d: %v", node.Host, node.Port, err)
		}
		if cluster.MetricPort > 0 {
			if err := consulDeregisterSvc(esMetricServiceID(cluster.ID, node.Host, cluster.MetricPort)); err != nil {
				log.Printf("[consul] deregister es metric %s:%d: %v", node.Host, cluster.MetricPort, err)
			}
		}
	}
}

// ---- ZooKeeper ----

func zkMainServiceID(clusterID uint, host string, port int) string {
	return fmt.Sprintf("mw-zk-%d-%s-%d", clusterID, host, port)
}

func zkMetricServiceID(clusterID uint, host string, metricPort int) string {
	return fmt.Sprintf("mw-zk-metrics-%d-%s-%d", clusterID, host, metricPort)
}

// zkParseServers splits "host1:port1,host2:port2" into a slice of {Host, Port}.
func zkParseServers(servers string) []struct {
	Host string
	Port int
} {
	var result []struct {
		Host string
		Port int
	}
	for _, s := range strings.Split(servers, ",") {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		parts := strings.SplitN(s, ":", 2)
		if len(parts) != 2 {
			continue
		}
		port, err := strconv.Atoi(strings.TrimSpace(parts[1]))
		if err != nil {
			continue
		}
		result = append(result, struct {
			Host string
			Port int
		}{Host: strings.TrimSpace(parts[0]), Port: port})
	}
	return result
}

// RegisterZKCluster registers every ZK server (main port + shared metric port) in Consul.
func RegisterZKCluster(cluster *models.ZKCluster) error {
	if !consulEnabled() {
		return nil
	}
	nodes := zkParseServers(cluster.Servers)
	var errs []string
	for _, node := range nodes {
		if err := consulRegisterSvc(consulPayload{
			ID:      zkMainServiceID(cluster.ID, node.Host, node.Port),
			Name:    cluster.Name + "-zk",
			Tags:    []string{"zookeeper", "mw-admin", cluster.Name},
			Address: node.Host,
			Port:    node.Port,
			Check:   tcpCheck(node.Host, node.Port),
		}); err != nil {
			errs = append(errs, fmt.Sprintf("%s:%d main: %v", node.Host, node.Port, err))
		}
		if cluster.MetricPort > 0 {
			if err := consulRegisterSvc(consulPayload{
				ID:      zkMetricServiceID(cluster.ID, node.Host, cluster.MetricPort),
				Name:    cluster.Name + "-zk-metrics",
				Tags:    []string{"zookeeper", "metrics", "mw-admin", cluster.Name},
				Address: node.Host,
				Port:    cluster.MetricPort,
				Check:   tcpCheck(node.Host, cluster.MetricPort),
			}); err != nil {
				errs = append(errs, fmt.Sprintf("%s metric: %v", node.Host, err))
			}
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf(strings.Join(errs, "; "))
	}
	return nil
}

// DeregisterZKCluster removes all Consul service entries for the ZK cluster.
func DeregisterZKCluster(cluster *models.ZKCluster) {
	if !consulEnabled() {
		return
	}
	for _, node := range zkParseServers(cluster.Servers) {
		if err := consulDeregisterSvc(zkMainServiceID(cluster.ID, node.Host, node.Port)); err != nil {
			log.Printf("[consul] deregister zk main %s:%d: %v", node.Host, node.Port, err)
		}
		if cluster.MetricPort > 0 {
			if err := consulDeregisterSvc(zkMetricServiceID(cluster.ID, node.Host, cluster.MetricPort)); err != nil {
				log.Printf("[consul] deregister zk metric %s:%d: %v", node.Host, cluster.MetricPort, err)
			}
		}
	}
}
