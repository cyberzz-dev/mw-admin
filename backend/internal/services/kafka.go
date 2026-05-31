package services

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"mw-admin/internal/db"
	"mw-admin/internal/models"
	"net"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/IBM/sarama"
)

func buildTLSConfig(cluster *models.KafkaCluster) *tls.Config {
	tlsCfg := &tls.Config{InsecureSkipVerify: cluster.TLSSkipVerify} // #nosec G402 — user-configured
	if cluster.TLSCACert != "" {
		pool := x509.NewCertPool()
		pool.AppendCertsFromPEM([]byte(cluster.TLSCACert))
		tlsCfg.RootCAs = pool
		tlsCfg.InsecureSkipVerify = false
	}
	return tlsCfg
}

func newSaramaConfig(cluster *models.KafkaCluster) (*sarama.Config, error) {
	cfg := sarama.NewConfig()
	cfg.Version = sarama.V2_6_0_0
	cfg.Net.DialTimeout = 10 * time.Second
	cfg.Net.ReadTimeout = 10 * time.Second
	cfg.Net.WriteTimeout = 10 * time.Second
	cfg.Metadata.RefreshFrequency = 30 * time.Second

	switch cluster.AuthType {
	case "PLAINTEXT":
		// no auth
	case "SASL_PLAIN":
		cfg.Net.SASL.Enable = true
		cfg.Net.SASL.Mechanism = sarama.SASLTypePlaintext
		cfg.Net.SASL.User = cluster.Username
		cfg.Net.SASL.Password = cluster.Password
	case "SCRAM-SHA-256":
		cfg.Net.SASL.Enable = true
		cfg.Net.SASL.Mechanism = sarama.SASLTypeSCRAMSHA256
		cfg.Net.SASL.User = cluster.Username
		cfg.Net.SASL.Password = cluster.Password
		cfg.Net.SASL.SCRAMClientGeneratorFunc = func() sarama.SCRAMClient {
			return &XDGSCRAMClient{HashGeneratorFcn: SHA256}
		}
		cfg.Net.TLS.Enable = false
	case "SCRAM-SHA-512":
		cfg.Net.SASL.Enable = true
		cfg.Net.SASL.Mechanism = sarama.SASLTypeSCRAMSHA512
		cfg.Net.SASL.User = cluster.Username
		cfg.Net.SASL.Password = cluster.Password
		cfg.Net.SASL.SCRAMClientGeneratorFunc = func() sarama.SCRAMClient {
			return &XDGSCRAMClient{HashGeneratorFcn: SHA512}
		}
		cfg.Net.TLS.Enable = false
	case "SSL_SCRAM-SHA-256":
		cfg.Net.SASL.Enable = true
		cfg.Net.SASL.Mechanism = sarama.SASLTypeSCRAMSHA256
		cfg.Net.SASL.User = cluster.Username
		cfg.Net.SASL.Password = cluster.Password
		cfg.Net.SASL.SCRAMClientGeneratorFunc = func() sarama.SCRAMClient {
			return &XDGSCRAMClient{HashGeneratorFcn: SHA256}
		}
		cfg.Net.TLS.Enable = true
	case "SSL_SCRAM-SHA-512":
		cfg.Net.SASL.Enable = true
		cfg.Net.SASL.Mechanism = sarama.SASLTypeSCRAMSHA512
		cfg.Net.SASL.User = cluster.Username
		cfg.Net.SASL.Password = cluster.Password
		cfg.Net.SASL.SCRAMClientGeneratorFunc = func() sarama.SCRAMClient {
			return &XDGSCRAMClient{HashGeneratorFcn: SHA512}
		}
		cfg.Net.TLS.Enable = true
	default:
		return nil, fmt.Errorf("unknown auth type: %s", cluster.AuthType)
	}

	cfg.Net.TLS.Config = buildTLSConfig(cluster)
	return cfg, nil
}

func clusterBrokers(cluster *models.KafkaCluster) []string {
	brokers := make([]string, 0, len(cluster.Nodes))
	for _, n := range cluster.Nodes {
		brokers = append(brokers, fmt.Sprintf("%s:%d", n.Host, n.Port))
	}
	return brokers
}

// TopicInfo holds basic topic metadata
type TopicInfo struct {
	Name             string `json:"name"`
	Partitions       int    `json:"partitions"`
	Replicas         int    `json:"replicas"`
	DiskSizeBytes    int64  `json:"disk_size_bytes"`
	LeaderPartitions int    `json:"leader_partitions"`
}

// TopicDetail holds full topic detail including replica & ISR distribution
type TopicDetail struct {
	Name       string            `json:"name"`
	Partitions []PartitionDetail `json:"partitions"`
}

type PartitionDetail struct {
	PartitionID     int32   `json:"partition_id"`
	Leader          int32   `json:"leader"`
	PreferredLeader bool    `json:"preferred_leader"`
	Replicas        []int32 `json:"replicas"`
	ISR             []int32 `json:"isr"`
	EarliestOffset  int64   `json:"earliest_offset"`
	LatestOffset    int64   `json:"latest_offset"`
	DiskSizeBytes   int64   `json:"disk_size_bytes"`
}

func GetTopics(cluster *models.KafkaCluster) ([]TopicInfo, error) {
	cfg, err := newSaramaConfig(cluster)
	if err != nil {
		return nil, err
	}
	client, err := sarama.NewClient(clusterBrokers(cluster), cfg)
	if err != nil {
		return nil, fmt.Errorf("connect kafka failed: %w", err)
	}
	defer client.Close()

	admin, err := sarama.NewClusterAdminFromClient(client)
	if err != nil {
		return nil, err
	}
	defer admin.Close()

	topics, err := admin.ListTopics()
	if err != nil {
		return nil, err
	}

	result := make([]TopicInfo, 0, len(topics))
	for name, detail := range topics {
		replicas := 0
		if len(detail.ReplicaAssignment) > 0 {
			for _, r := range detail.ReplicaAssignment {
				replicas = len(r)
				break
			}
		}
		leaderCount := 0
		for partID, replList := range detail.ReplicaAssignment {
			if len(replList) > 0 {
				leader, err := client.Leader(name, partID)
				if err == nil && leader.ID() == replList[0] {
					leaderCount++
				}
			}
		}
		result = append(result, TopicInfo{
			Name:             name,
			Partitions:       int(detail.NumPartitions),
			Replicas:         replicas,
			LeaderPartitions: leaderCount,
		})
	}
	return result, nil
}

// GetTopicDiskSizes returns per-topic disk size in bytes via DescribeLogDirs.
func GetTopicDiskSizes(cluster *models.KafkaCluster) (map[string]int64, error) {
	cfg, err := newSaramaConfig(cluster)
	if err != nil {
		return nil, err
	}
	client, err := sarama.NewClient(clusterBrokers(cluster), cfg)
	if err != nil {
		return nil, fmt.Errorf("connect kafka failed: %w", err)
	}
	defer client.Close()
	admin, err := sarama.NewClusterAdminFromClient(client)
	if err != nil {
		return nil, err
	}
	defer admin.Close()

	brokers := client.Brokers()
	brokerIDs := make([]int32, len(brokers))
	for i, b := range brokers {
		brokerIDs[i] = b.ID()
	}
	logDirs, err := admin.DescribeLogDirs(brokerIDs)
	if err != nil {
		return nil, err
	}
	sizes := make(map[string]int64)
	for _, dirList := range logDirs {
		for _, dir := range dirList {
			for _, t := range dir.Topics {
				for _, p := range t.Partitions {
					sizes[t.Topic] += p.Size
				}
			}
		}
	}
	return sizes, nil
}

func GetTopicDetail(cluster *models.KafkaCluster, topicName string) (*TopicDetail, error) {
	cfg, err := newSaramaConfig(cluster)
	if err != nil {
		return nil, err
	}
	client, err := sarama.NewClient(clusterBrokers(cluster), cfg)
	if err != nil {
		return nil, fmt.Errorf("connect kafka failed: %w", err)
	}
	defer client.Close()

	admin, err := sarama.NewClusterAdminFromClient(client)
	if err != nil {
		return nil, err
	}
	defer admin.Close()

	partitions, err := client.Partitions(topicName)
	if err != nil {
		return nil, err
	}

	// Build per-partition disk size map by summing across all brokers
	// (each broker stores the replicas it is responsible for)
	partDisk := make(map[int32]int64)
	brokers := client.Brokers()
	if len(brokers) > 0 {
		brokerIDs := make([]int32, len(brokers))
		for i, b := range brokers {
			brokerIDs[i] = b.ID()
		}
		if logDirs, err := admin.DescribeLogDirs(brokerIDs); err == nil {
			for _, dirList := range logDirs {
				for _, dir := range dirList {
					for _, t := range dir.Topics {
						if t.Topic != topicName {
							continue
						}
						for _, p := range t.Partitions {
							partDisk[p.PartitionID] += p.Size
						}
					}
				}
			}
		}
	}

	details := make([]PartitionDetail, 0, len(partitions))
	for _, p := range partitions {
		leader, _ := client.Leader(topicName, p)
		replicas, _ := client.Replicas(topicName, p)
		isr, _ := client.InSyncReplicas(topicName, p)

		leaderID := int32(-1)
		if leader != nil {
			leaderID = leader.ID()
		}

		earliest, _ := client.GetOffset(topicName, p, sarama.OffsetOldest)
		latest, _ := client.GetOffset(topicName, p, sarama.OffsetNewest)

		details = append(details, PartitionDetail{
			PartitionID:     p,
			Leader:          leaderID,
			PreferredLeader: len(replicas) > 0 && leaderID == replicas[0],
			Replicas:        replicas,
			ISR:             isr,
			EarliestOffset:  earliest,
			LatestOffset:    latest,
			DiskSizeBytes:   partDisk[p],
		})
	}

	return &TopicDetail{Name: topicName, Partitions: details}, nil
}

func CreateTopic(cluster *models.KafkaCluster, name string, partitions int32, replicas int16) error {
	cfg, err := newSaramaConfig(cluster)
	if err != nil {
		return err
	}
	admin, err := sarama.NewClusterAdmin(clusterBrokers(cluster), cfg)
	if err != nil {
		return err
	}
	defer admin.Close()
	return admin.CreateTopic(name, &sarama.TopicDetail{
		NumPartitions:     partitions,
		ReplicationFactor: replicas,
	}, false)
}

func DeleteTopic(cluster *models.KafkaCluster, name string) error {
	cfg, err := newSaramaConfig(cluster)
	if err != nil {
		return err
	}
	admin, err := sarama.NewClusterAdmin(clusterBrokers(cluster), cfg)
	if err != nil {
		return err
	}
	defer admin.Close()
	return admin.DeleteTopic(name)
}

func UpdateTopicPartitions(cluster *models.KafkaCluster, name string, count int32) error {
	cfg, err := newSaramaConfig(cluster)
	if err != nil {
		return err
	}
	admin, err := sarama.NewClusterAdmin(clusterBrokers(cluster), cfg)
	if err != nil {
		return err
	}
	defer admin.Close()
	return admin.CreatePartitions(name, count, nil, false)
}

// AdjustReplication changes the replication factor of a topic by reassigning
// partitions across brokers using a round-robin strategy.
func AdjustReplication(cluster *models.KafkaCluster, topicName string, newRF int) error {
	if newRF < 1 {
		return fmt.Errorf("副本数不能小于1")
	}
	cfg, err := newSaramaConfig(cluster)
	if err != nil {
		return err
	}
	client, err := sarama.NewClient(clusterBrokers(cluster), cfg)
	if err != nil {
		return fmt.Errorf("connect failed: %w", err)
	}
	defer client.Close()

	admin, err := sarama.NewClusterAdminFromClient(client)
	if err != nil {
		return err
	}
	defer admin.Close()

	partitions, err := client.Partitions(topicName)
	if err != nil {
		return err
	}
	if len(partitions) == 0 {
		return fmt.Errorf("topic %s 无分区", topicName)
	}

	brokers := client.Brokers()
	numBrokers := len(brokers)
	if numBrokers < newRF {
		return fmt.Errorf("集群broker数量(%d)不足，无法设置副本数为%d", numBrokers, newRF)
	}

	brokerIDs := make([]int32, numBrokers)
	for i, b := range brokers {
		brokerIDs[i] = b.ID()
	}
	sort.Slice(brokerIDs, func(i, j int) bool { return brokerIDs[i] < brokerIDs[j] })

	// Find max partition ID to size the assignment slice
	maxPartID := int32(0)
	for _, p := range partitions {
		if p > maxPartID {
			maxPartID = p
		}
	}

	// assignment[partitionID] = new replica broker list
	// Round-robin: partition p starts at brokerIDs[p % numBrokers]
	assignment := make([][]int32, maxPartID+1)
	for _, p := range partitions {
		replicas := make([]int32, newRF)
		for r := 0; r < newRF; r++ {
			replicas[r] = brokerIDs[(int(p)+r)%numBrokers]
		}
		assignment[p] = replicas
	}

	return admin.AlterPartitionReassignments(topicName, assignment)
}

// BrokerInfo holds basic broker information.
type BrokerInfo struct {
	ID                  int32  `json:"id"`
	Addr                string `json:"addr"`
	Host                string `json:"host"`
	Port                int32  `json:"port"`
	LeaderCount         int    `json:"leader_count"`
	PartitionCount      int    `json:"partition_count"`
	LogSize             int64  `json:"log_size"`
	AdvertisedListeners string `json:"advertised_listeners"`
}

// ListClusterBrokers returns all brokers in the cluster sorted by ID.
func ListClusterBrokers(cluster *models.KafkaCluster) ([]BrokerInfo, error) {
	cfg, err := newSaramaConfig(cluster)
	if err != nil {
		return nil, err
	}
	client, err := sarama.NewClient(clusterBrokers(cluster), cfg)
	if err != nil {
		return nil, fmt.Errorf("connect failed: %w", err)
	}
	defer client.Close()

	brokers := client.Brokers()
	infoMap := make(map[int32]*BrokerInfo, len(brokers))
	for _, b := range brokers {
		host, portStr, _ := net.SplitHostPort(b.Addr())
		portNum, _ := strconv.ParseInt(portStr, 10, 32)
		infoMap[b.ID()] = &BrokerInfo{
			ID:   b.ID(),
			Addr: b.Addr(),
			Host: host,
			Port: int32(portNum),
		}
	}

	// Build broker IDs slice.
	brokerIDs := make([]int32, 0, len(brokers))
	for _, b := range brokers {
		brokerIDs = append(brokerIDs, b.ID())
	}

	// Use admin for DescribeLogDirs and DescribeConfig.
	// IMPORTANT: do NOT call admin.Close() — sarama.NewClusterAdminFromClient shares
	// the caller's client, and Close() would close it, breaking subsequent client calls.
	if admin, adminErr := sarama.NewClusterAdminFromClient(client); adminErr == nil {
		// Populate log sizes.
		if logDirs, err := admin.DescribeLogDirs(brokerIDs); err == nil {
			for bID, dirList := range logDirs {
				var total int64
				for _, dir := range dirList {
					for _, t := range dir.Topics {
						for _, p := range t.Partitions {
							total += p.Size
						}
					}
				}
				if info, ok := infoMap[bID]; ok {
					info.LogSize = total
				}
			}
		}
		// Populate advertised.listeners from broker config.
		for bID := range infoMap {
			entries, err := admin.DescribeConfig(sarama.ConfigResource{
				Type:        sarama.BrokerResource,
				Name:        fmt.Sprintf("%d", bID),
				ConfigNames: []string{"advertised.listeners"},
			})
			if err != nil {
				continue
			}
			for _, entry := range entries {
				if entry.Name == "advertised.listeners" {
					infoMap[bID].AdvertisedListeners = entry.Value
					break
				}
			}
		}
	}

	// Compute per-broker partition counts from topic metadata.
	if topics, err := client.Topics(); err == nil {
		for _, topic := range topics {
			partitions, err := client.Partitions(topic)
			if err != nil {
				continue
			}
			for _, p := range partitions {
				if replicas, err := client.Replicas(topic, p); err == nil {
					for _, rid := range replicas {
						if info, ok := infoMap[rid]; ok {
							info.PartitionCount++
						}
					}
				}
				if leader, err := client.Leader(topic, p); err == nil {
					if info, ok := infoMap[leader.ID()]; ok {
						info.LeaderCount++
					}
				}
			}
		}
	}

	result := make([]BrokerInfo, 0, len(infoMap))
	for _, info := range infoMap {
		result = append(result, *info)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result, nil
}

// BrokerPartitionInfo describes a single topic-partition stored on a broker.
type BrokerPartitionInfo struct {
	Topic       string `json:"topic"`
	PartitionID int32  `json:"partition_id"`
	IsLeader    bool   `json:"is_leader"`
	LogSize     int64  `json:"log_size"`
}

// ListBrokerPartitions returns all topic-partitions stored on the given broker with their log sizes.
func ListBrokerPartitions(cluster *models.KafkaCluster, brokerID int32) ([]BrokerPartitionInfo, error) {
	cfg, err := newSaramaConfig(cluster)
	if err != nil {
		return nil, err
	}
	client, err := sarama.NewClient(clusterBrokers(cluster), cfg)
	if err != nil {
		return nil, fmt.Errorf("connect failed: %w", err)
	}
	defer client.Close()

	admin, err := sarama.NewClusterAdminFromClient(client)
	if err != nil {
		return nil, err
	}
	defer admin.Close()

	logDirs, err := admin.DescribeLogDirs([]int32{brokerID})
	if err != nil {
		return nil, fmt.Errorf("describe log dirs: %w", err)
	}

	var result []BrokerPartitionInfo
	for _, dirList := range logDirs {
		for _, dir := range dirList {
			for _, t := range dir.Topics {
				for _, p := range t.Partitions {
					leader, err := client.Leader(t.Topic, p.PartitionID)
					isLeader := err == nil && leader.ID() == brokerID
					result = append(result, BrokerPartitionInfo{
						Topic:       t.Topic,
						PartitionID: p.PartitionID,
						IsLeader:    isLeader,
						LogSize:     p.Size,
					})
				}
			}
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Topic != result[j].Topic {
			return result[i].Topic < result[j].Topic
		}
		return result[i].PartitionID < result[j].PartitionID
	})
	return result, nil
}

// GetTopicAssignment returns the current partition→replica assignment.
// Keys are partition IDs; values are ordered replica broker ID lists.
func GetTopicAssignment(cluster *models.KafkaCluster, topicName string) (map[int32][]int32, error) {
	cfg, err := newSaramaConfig(cluster)
	if err != nil {
		return nil, err
	}
	client, err := sarama.NewClient(clusterBrokers(cluster), cfg)
	if err != nil {
		return nil, fmt.Errorf("connect failed: %w", err)
	}
	defer client.Close()

	partitions, err := client.Partitions(topicName)
	if err != nil {
		return nil, err
	}

	assignment := make(map[int32][]int32, len(partitions))
	for _, p := range partitions {
		replicas, err := client.Replicas(topicName, p)
		if err != nil {
			return nil, fmt.Errorf("get replicas for partition %d: %w", p, err)
		}
		assignment[p] = replicas
	}
	return assignment, nil
}

// ApplyAssignment submits a raw partition→replica assignment to Kafka.
func ApplyAssignment(cluster *models.KafkaCluster, topicName string, assignment map[int32][]int32) error {
	if len(assignment) == 0 {
		return fmt.Errorf("assignment 不能为空")
	}
	cfg, err := newSaramaConfig(cluster)
	if err != nil {
		return err
	}
	admin, err := sarama.NewClusterAdmin(clusterBrokers(cluster), cfg)
	if err != nil {
		return err
	}
	defer admin.Close()

	maxID := int32(0)
	for p := range assignment {
		if p > maxID {
			maxID = p
		}
	}

	saramaAssignment := make([][]int32, maxID+1)
	for p, replicas := range assignment {
		saramaAssignment[p] = replicas
	}
	return admin.AlterPartitionReassignments(topicName, saramaAssignment)
}

type ReassignmentTaskView struct {
	ID                  uint                         `json:"id"`
	ClusterID           uint                         `json:"cluster_id"`
	Topic               string                       `json:"topic"`
	Operation           string                       `json:"operation"`
	SourceBroker        int32                        `json:"source_broker"`
	TargetBroker        int32                        `json:"target_broker"`
	ThrottleBytesPerSec int64                        `json:"throttle_bytes_per_sec"`
	Partitions          []int32                      `json:"partitions"`
	OriginalAssignment  map[int32][]int32            `json:"original_assignment"`
	TargetAssignment    map[int32][]int32            `json:"target_assignment"`
	FinalAssignment     map[int32][]int32            `json:"final_assignment"`
	Status              string                       `json:"status"`
	Message             string                       `json:"message"`
	Ongoing             map[int32]ReassignmentStatus `json:"ongoing,omitempty"`
	CreatedAt           time.Time                    `json:"created_at"`
	UpdatedAt           time.Time                    `json:"updated_at"`
}

type ReassignmentStatus struct {
	Replicas         []int32 `json:"replicas"`
	AddingReplicas   []int32 `json:"adding_replicas"`
	RemovingReplicas []int32 `json:"removing_replicas"`
}

func reassignmentTaskView(task models.KafkaReassignmentTask) ReassignmentTaskView {
	var partitions []int32
	var original map[int32][]int32
	var target map[int32][]int32
	var final map[int32][]int32
	_ = json.Unmarshal([]byte(task.PartitionsJSON), &partitions)
	_ = json.Unmarshal([]byte(task.OriginalAssignmentJSON), &original)
	_ = json.Unmarshal([]byte(task.TargetAssignmentJSON), &target)
	if task.FinalAssignmentJSON != "" {
		_ = json.Unmarshal([]byte(task.FinalAssignmentJSON), &final)
	}
	return ReassignmentTaskView{
		ID:                  task.ID,
		ClusterID:           task.ClusterID,
		Topic:               task.Topic,
		Operation:           task.Operation,
		SourceBroker:        task.SourceBroker,
		TargetBroker:        task.TargetBroker,
		ThrottleBytesPerSec: task.ThrottleBytesPerSec,
		Partitions:          partitions,
		OriginalAssignment:  original,
		TargetAssignment:    target,
		FinalAssignment:     final,
		Status:              task.Status,
		Message:             task.Message,
		CreatedAt:           task.CreatedAt,
		UpdatedAt:           task.UpdatedAt,
	}
}

func ListReassignmentTasks(clusterID uint, topic string) ([]ReassignmentTaskView, error) {
	query := db.DB.Where("cluster_id = ?", clusterID).Order("created_at desc")
	if topic != "" {
		query = query.Where("topic = ?", topic)
	}
	var tasks []models.KafkaReassignmentTask
	if err := query.Find(&tasks).Error; err != nil {
		return nil, err
	}
	views := make([]ReassignmentTaskView, 0, len(tasks))
	for _, task := range tasks {
		views = append(views, reassignmentTaskView(task))
	}
	return views, nil
}

func SubmitPartitionMigration(cluster *models.KafkaCluster, topicName string, srcBroker, dstBroker int32, partitions []int32, throttleBytesPerSec int64, createdBy uint) (*ReassignmentTaskView, error) {
	if srcBroker == dstBroker {
		return nil, fmt.Errorf("source and target brokers must be different")
	}
	if throttleBytesPerSec <= 0 {
		return nil, fmt.Errorf("migration throttle must be greater than 0 bytes/sec")
	}
	original, err := GetTopicAssignment(cluster, topicName)
	if err != nil {
		return nil, err
	}

	selected := normalizeMigrationPartitions(original, srcBroker, partitions)
	if len(selected) == 0 {
		return nil, fmt.Errorf("broker %d is not present in any selected partition replica list for topic %s", srcBroker, topicName)
	}

	target := copyAssignment(original)
	for _, p := range selected {
		replicas := target[p]
		for i, brokerID := range replicas {
			if brokerID == srcBroker {
				replicas[i] = dstBroker
			}
		}
		target[p] = replicas
	}
	if err := validateAssignment(target); err != nil {
		return nil, err
	}

	partitionsJSON, _ := json.Marshal(selected)
	originalJSON, _ := json.Marshal(original)
	targetJSON, _ := json.Marshal(target)
	task := models.KafkaReassignmentTask{
		ClusterID:              cluster.ID,
		Topic:                  topicName,
		Operation:              "partition_migration",
		SourceBroker:           srcBroker,
		TargetBroker:           dstBroker,
		ThrottleBytesPerSec:    throttleBytesPerSec,
		PartitionsJSON:         string(partitionsJSON),
		OriginalAssignmentJSON: string(originalJSON),
		TargetAssignmentJSON:   string(targetJSON),
		Status:                 "preparing",
		Message:                "Partition migration task created; submitting Kafka reassignment",
		CreatedBy:              createdBy,
	}
	if err := db.DB.Create(&task).Error; err != nil {
		return nil, err
	}

	if err := setReassignmentThrottle(cluster, topicName, original, target, selected, throttleBytesPerSec); err != nil {
		setTaskStatus(&task, "failed", "Failed to set migration throttle: "+err.Error())
		return nil, fmt.Errorf("failed to set migration throttle: %w", err)
	}
	if err := ApplyAssignment(cluster, topicName, target); err != nil {
		_ = clearReassignmentThrottle(cluster, topicName, original, target, selected)
		setTaskStatus(&task, "failed", "Failed to submit Kafka reassignment: "+err.Error())
		return nil, err
	}
	setTaskStatus(&task, "submitted", "Partition migration submitted; waiting for verification")
	view := reassignmentTaskView(task)
	return &view, nil
}

func SubmitReplicaAssignment(cluster *models.KafkaCluster, topicName string, target map[int32][]int32, throttleBytesPerSec int64, createdBy uint) (*ReassignmentTaskView, error) {
	if throttleBytesPerSec <= 0 {
		return nil, fmt.Errorf("replica adjustment throttle must be greater than 0 bytes/sec")
	}
	if len(target) == 0 {
		return nil, fmt.Errorf("assignment cannot be empty")
	}
	if err := validateAssignment(target); err != nil {
		return nil, err
	}
	original, err := GetTopicAssignment(cluster, topicName)
	if err != nil {
		return nil, err
	}
	selected := changedAssignmentPartitions(original, target)
	if len(selected) == 0 {
		return nil, fmt.Errorf("replica assignment has no changes")
	}

	partitionsJSON, _ := json.Marshal(selected)
	originalJSON, _ := json.Marshal(original)
	targetJSON, _ := json.Marshal(target)
	task := models.KafkaReassignmentTask{
		ClusterID:              cluster.ID,
		Topic:                  topicName,
		Operation:              "replica_adjustment",
		ThrottleBytesPerSec:    throttleBytesPerSec,
		PartitionsJSON:         string(partitionsJSON),
		OriginalAssignmentJSON: string(originalJSON),
		TargetAssignmentJSON:   string(targetJSON),
		Status:                 "preparing",
		Message:                "Replica adjustment task created; submitting Kafka reassignment",
		CreatedBy:              createdBy,
	}
	if err := db.DB.Create(&task).Error; err != nil {
		return nil, err
	}

	if err := setReassignmentThrottle(cluster, topicName, original, target, selected, throttleBytesPerSec); err != nil {
		setTaskStatus(&task, "failed", "Failed to set replica adjustment throttle: "+err.Error())
		return nil, fmt.Errorf("failed to set replica adjustment throttle: %w", err)
	}
	if err := ApplyAssignment(cluster, topicName, target); err != nil {
		_ = clearReassignmentThrottle(cluster, topicName, original, target, selected)
		setTaskStatus(&task, "failed", "Failed to submit Kafka reassignment: "+err.Error())
		return nil, err
	}
	setTaskStatus(&task, "submitted", "Replica adjustment submitted; waiting for verification")
	view := reassignmentTaskView(task)
	return &view, nil
}

func VerifyReassignmentTask(cluster *models.KafkaCluster, taskID uint) (*ReassignmentTaskView, error) {
	task, partitions, original, target, err := loadReassignmentTask(cluster.ID, taskID)
	if err != nil {
		return nil, err
	}
	if task.Status == "cancelled" || task.Status == "failed" {
		view := reassignmentTaskView(task)
		return &view, nil
	}

	ongoing, err := listReassignmentStatus(cluster, task.Topic, partitions)
	if err != nil {
		setTaskStatus(&task, "failed", err.Error())
		return nil, err
	}
	view := reassignmentTaskView(task)
	view.Ongoing = ongoing
	if len(ongoing) > 0 {
		setTaskStatus(&task, "running", fmt.Sprintf("%d partition(s) still reassigning", len(ongoing)))
		view = reassignmentTaskView(task)
		view.Ongoing = ongoing
		return &view, nil
	}

	current, err := GetTopicAssignment(cluster, task.Topic)
	if err != nil {
		setTaskStatus(&task, "failed", err.Error())
		return nil, err
	}
	setTaskFinalAssignment(&task, current)
	if mismatch := assignmentMismatchMessage(current, target, partitions, task.Operation); mismatch != "" {
		setTaskStatus(&task, "failed", "Kafka has no active reassignment, but current replicas do not match the target assignment: "+mismatch)
		view = reassignmentTaskView(task)
		return &view, nil
	}
	if err := clearReassignmentThrottle(cluster, task.Topic, original, target, partitions); err != nil {
		setTaskStatus(&task, "completed", "Reassignment completed, but failed to clear throttle configs: "+err.Error())
	} else {
		setTaskStatus(&task, "completed", "Reassignment completed; throttle configs cleared")
	}
	view = reassignmentTaskView(task)
	return &view, nil
}

func CancelReassignmentTask(cluster *models.KafkaCluster, taskID uint) (*ReassignmentTaskView, error) {
	task, partitions, original, target, err := loadReassignmentTask(cluster.ID, taskID)
	if err != nil {
		return nil, err
	}
	if task.Status == "completed" || task.Status == "cancelled" {
		view := reassignmentTaskView(task)
		return &view, nil
	}
	if err := cancelPartitionReassignments(cluster, task.Topic, partitions); err != nil {
		setTaskStatus(&task, "failed", "Failed to cancel reassignment: "+err.Error())
		return nil, err
	}
	if err := clearReassignmentThrottle(cluster, task.Topic, original, target, partitions); err != nil {
		setTaskStatus(&task, "cancelled", "Reassignment cancelled, but failed to clear throttle configs: "+err.Error())
	} else {
		setTaskStatus(&task, "cancelled", "Reassignment cancelled; throttle configs cleared")
	}
	if current, err := GetTopicAssignment(cluster, task.Topic); err == nil {
		setTaskFinalAssignment(&task, current)
	}
	view := reassignmentTaskView(task)
	return &view, nil
}

func normalizeMigrationPartitions(assignment map[int32][]int32, srcBroker int32, requested []int32) []int32 {
	seen := make(map[int32]bool)
	selected := make([]int32, 0)
	if len(requested) == 0 {
		for p, replicas := range assignment {
			if containsBroker(replicas, srcBroker) {
				selected = append(selected, p)
			}
		}
	} else {
		for _, p := range requested {
			if seen[p] || !containsBroker(assignment[p], srcBroker) {
				continue
			}
			seen[p] = true
			selected = append(selected, p)
		}
	}
	sort.Slice(selected, func(i, j int) bool { return selected[i] < selected[j] })
	return selected
}

func changedAssignmentPartitions(original, target map[int32][]int32) []int32 {
	selected := make([]int32, 0)
	for p, replicas := range target {
		if !int32SliceEqual(original[p], replicas) {
			selected = append(selected, p)
		}
	}
	sort.Slice(selected, func(i, j int) bool { return selected[i] < selected[j] })
	return selected
}

func copyAssignment(in map[int32][]int32) map[int32][]int32 {
	out := make(map[int32][]int32, len(in))
	for p, replicas := range in {
		out[p] = append([]int32(nil), replicas...)
	}
	return out
}

func containsBroker(replicas []int32, brokerID int32) bool {
	for _, id := range replicas {
		if id == brokerID {
			return true
		}
	}
	return false
}

func validateAssignment(assignment map[int32][]int32) error {
	for p, replicas := range assignment {
		seen := make(map[int32]bool, len(replicas))
		for _, brokerID := range replicas {
			if seen[brokerID] {
				return fmt.Errorf("partition %d replica list contains duplicate broker %d", p, brokerID)
			}
			seen[brokerID] = true
		}
	}
	return nil
}

func loadReassignmentTask(clusterID uint, taskID uint) (models.KafkaReassignmentTask, []int32, map[int32][]int32, map[int32][]int32, error) {
	var task models.KafkaReassignmentTask
	if err := db.DB.Where("cluster_id = ? AND id = ?", clusterID, taskID).First(&task).Error; err != nil {
		return task, nil, nil, nil, err
	}
	var partitions []int32
	var original map[int32][]int32
	var target map[int32][]int32
	if err := json.Unmarshal([]byte(task.PartitionsJSON), &partitions); err != nil {
		return task, nil, nil, nil, err
	}
	if err := json.Unmarshal([]byte(task.OriginalAssignmentJSON), &original); err != nil {
		return task, nil, nil, nil, err
	}
	if err := json.Unmarshal([]byte(task.TargetAssignmentJSON), &target); err != nil {
		return task, nil, nil, nil, err
	}
	return task, partitions, original, target, nil
}

func setTaskStatus(task *models.KafkaReassignmentTask, status string, message string) {
	task.Status = status
	task.Message = message
	_ = db.DB.Model(task).Updates(map[string]interface{}{"status": status, "message": message}).Error
}

func setTaskFinalAssignment(task *models.KafkaReassignmentTask, assignment map[int32][]int32) {
	assignmentJSON, _ := json.Marshal(assignment)
	task.FinalAssignmentJSON = string(assignmentJSON)
	_ = db.DB.Model(task).Update("final_assignment_json", task.FinalAssignmentJSON).Error
}

func listReassignmentStatus(cluster *models.KafkaCluster, topic string, partitions []int32) (map[int32]ReassignmentStatus, error) {
	cfg, err := newSaramaConfig(cluster)
	if err != nil {
		return nil, err
	}
	admin, err := sarama.NewClusterAdmin(clusterBrokers(cluster), cfg)
	if err != nil {
		return nil, err
	}
	defer admin.Close()
	statuses, err := admin.ListPartitionReassignments(topic, partitions)
	if err != nil {
		return nil, err
	}
	result := make(map[int32]ReassignmentStatus)
	for p, status := range statuses[topic] {
		result[p] = ReassignmentStatus{Replicas: status.Replicas, AddingReplicas: status.AddingReplicas, RemovingReplicas: status.RemovingReplicas}
	}
	return result, nil
}

func assignmentMismatchMessage(current, target map[int32][]int32, partitions []int32, operation string) string {
	mismatches := make([]string, 0)
	for _, p := range partitions {
		currentReplicas := current[p]
		targetReplicas := target[p]
		matched := int32SliceEqual(currentReplicas, targetReplicas)
		if operation == "replica_adjustment" {
			matched = int32SetEqual(currentReplicas, targetReplicas)
		}
		if !matched {
			mismatches = append(mismatches, fmt.Sprintf("partition %d current=%v target=%v", p, currentReplicas, targetReplicas))
		}
	}
	if len(mismatches) == 0 {
		return ""
	}
	if len(mismatches) > 3 {
		return strings.Join(mismatches[:3], "; ") + fmt.Sprintf("; ... and %d more", len(mismatches)-3)
	}
	return strings.Join(mismatches, "; ")
}

func int32SliceEqual(a, b []int32) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func int32SetEqual(a, b []int32) bool {
	if len(a) != len(b) {
		return false
	}
	counts := make(map[int32]int, len(a))
	for _, value := range a {
		counts[value]++
	}
	for _, value := range b {
		counts[value]--
		if counts[value] < 0 {
			return false
		}
	}
	return true
}

func setReassignmentThrottle(cluster *models.KafkaCluster, topic string, original, target map[int32][]int32, partitions []int32, throttleBytesPerSec int64) error {
	throttledReplicas := buildThrottledReplicas(original, target, partitions)
	value := strconv.FormatInt(throttleBytesPerSec, 10)
	return alterReassignmentThrottleConfigs(cluster, topic, throttledReplicas, &value)
}

func clearReassignmentThrottle(cluster *models.KafkaCluster, topic string, original, target map[int32][]int32, partitions []int32) error {
	return alterReassignmentThrottleConfigs(cluster, topic, buildThrottledReplicas(original, target, partitions), nil)
}

func buildThrottledReplicas(original, target map[int32][]int32, partitions []int32) map[int32]bool {
	brokers := make(map[int32]bool)
	for _, p := range partitions {
		for _, brokerID := range original[p] {
			brokers[brokerID] = true
		}
		for _, brokerID := range target[p] {
			brokers[brokerID] = true
		}
	}
	return brokers
}

func alterReassignmentThrottleConfigs(cluster *models.KafkaCluster, topic string, brokerIDs map[int32]bool, rate *string) error {
	cfg, err := newSaramaConfig(cluster)
	if err != nil {
		return err
	}
	admin, err := sarama.NewClusterAdmin(clusterBrokers(cluster), cfg)
	if err != nil {
		return err
	}
	defer admin.Close()

	topicEntries := make(map[string]sarama.IncrementalAlterConfigsEntry)
	if rate != nil {
		all := "*"
		topicEntries["leader.replication.throttled.replicas"] = sarama.IncrementalAlterConfigsEntry{Operation: sarama.IncrementalAlterConfigsOperationSet, Value: &all}
		topicEntries["follower.replication.throttled.replicas"] = sarama.IncrementalAlterConfigsEntry{Operation: sarama.IncrementalAlterConfigsOperationSet, Value: &all}
	} else {
		topicEntries["leader.replication.throttled.replicas"] = sarama.IncrementalAlterConfigsEntry{Operation: sarama.IncrementalAlterConfigsOperationDelete}
		topicEntries["follower.replication.throttled.replicas"] = sarama.IncrementalAlterConfigsEntry{Operation: sarama.IncrementalAlterConfigsOperationDelete}
	}
	if err := admin.IncrementalAlterConfig(sarama.TopicResource, topic, topicEntries, false); err != nil {
		return err
	}
	for brokerID := range brokerIDs {
		entries := make(map[string]sarama.IncrementalAlterConfigsEntry)
		if rate != nil {
			entries["leader.replication.throttled.rate"] = sarama.IncrementalAlterConfigsEntry{Operation: sarama.IncrementalAlterConfigsOperationSet, Value: rate}
			entries["follower.replication.throttled.rate"] = sarama.IncrementalAlterConfigsEntry{Operation: sarama.IncrementalAlterConfigsOperationSet, Value: rate}
		} else {
			entries["leader.replication.throttled.rate"] = sarama.IncrementalAlterConfigsEntry{Operation: sarama.IncrementalAlterConfigsOperationDelete}
			entries["follower.replication.throttled.rate"] = sarama.IncrementalAlterConfigsEntry{Operation: sarama.IncrementalAlterConfigsOperationDelete}
		}
		if err := admin.IncrementalAlterConfig(sarama.BrokerResource, strconv.Itoa(int(brokerID)), entries, false); err != nil {
			return err
		}
	}
	return nil
}

func cancelPartitionReassignments(cluster *models.KafkaCluster, topic string, partitions []int32) error {
	cfg, err := newSaramaConfig(cluster)
	if err != nil {
		return err
	}
	client, err := sarama.NewClient(clusterBrokers(cluster), cfg)
	if err != nil {
		return err
	}
	defer client.Close()
	controller, err := client.Controller()
	if err != nil {
		return err
	}
	req := &sarama.AlterPartitionReassignmentsRequest{TimeoutMs: int32(60000), Version: int16(0)}
	for _, p := range partitions {
		req.AddBlock(topic, p, nil)
	}
	resp, err := controller.AlterPartitionReassignments(req)
	if err != nil {
		return err
	}
	if resp.ErrorCode != sarama.ErrNoError {
		return resp.ErrorCode
	}
	return nil
}

// MigratePartitions replaces srcBroker with dstBroker in every replica list for the topic.
func MigratePartitions(cluster *models.KafkaCluster, topicName string, srcBroker, dstBroker int32) error {
	if srcBroker == dstBroker {
		return fmt.Errorf("源和目标 broker 不能相同")
	}
	assignment, err := GetTopicAssignment(cluster, topicName)
	if err != nil {
		return err
	}

	changed := false
	for p, replicas := range assignment {
		for i, r := range replicas {
			if r == srcBroker {
				replicas[i] = dstBroker
				changed = true
			}
		}
		assignment[p] = replicas
	}
	if !changed {
		return fmt.Errorf("broker %d 未出现在 topic %s 的任何副本列表中", srcBroker, topicName)
	}
	return ApplyAssignment(cluster, topicName, assignment)
}

// ConsumerGroup types

// ConsumerGroupTopicSummary is one row in the list: one entry per (group, topic)
type ConsumerGroupTopicSummary struct {
	GroupID  string `json:"group_id"`
	Topic    string `json:"topic"`
	TotalLag int64  `json:"total_lag"`
}

type PartitionLagDetail struct {
	Partition      int32  `json:"partition"`
	Leader         int32  `json:"leader"`
	LogStartOffset int64  `json:"log_start_offset"`
	LogEndOffset   int64  `json:"log_end_offset"`
	ConsumerOffset int64  `json:"consumer_offset"`
	Lag            int64  `json:"lag"`
	ClientID       string `json:"client_id"`
	MemberID       string `json:"member_id"`
	ClientHost     string `json:"client_host"`
}

type ConsumerGroupTopicDetail struct {
	Topic      string               `json:"topic"`
	Partitions []PartitionLagDetail `json:"partitions"`
}

type ConsumerGroupDetail struct {
	GroupID  string                     `json:"group_id"`
	State    string                     `json:"state"`
	Protocol string                     `json:"protocol"`
	Topics   []ConsumerGroupTopicDetail `json:"topics"`
}

func ListConsumerGroups(cluster *models.KafkaCluster) ([]ConsumerGroupTopicSummary, error) {
	cfg, err := newSaramaConfig(cluster)
	if err != nil {
		return nil, err
	}
	admin, err := sarama.NewClusterAdmin(clusterBrokers(cluster), cfg)
	if err != nil {
		return nil, err
	}
	defer admin.Close()

	client, err := sarama.NewClient(clusterBrokers(cluster), cfg)
	if err != nil {
		return nil, err
	}
	defer client.Close()

	groupMap, err := admin.ListConsumerGroups()
	if err != nil {
		return nil, err
	}

	type entry struct {
		groupID string
		topic   string
		lag     int64
	}

	var mu sync.Mutex
	var wg sync.WaitGroup
	var entries []entry
	sem := make(chan struct{}, 10) // limit concurrency

	for groupID := range groupMap {
		wg.Add(1)
		gid := groupID
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			offsetMap, err := admin.ListConsumerGroupOffsets(gid, nil)
			if err != nil {
				return
			}
			for topic, partMap := range offsetMap.Blocks {
				lag := int64(0)
				for partition, block := range partMap {
					if block.Offset < 0 {
						continue
					}
					latest, err := client.GetOffset(topic, int32(partition), sarama.OffsetNewest)
					if err == nil && latest > block.Offset {
						lag += latest - block.Offset
					}
				}
				mu.Lock()
				entries = append(entries, entry{groupID: gid, topic: topic, lag: lag})
				mu.Unlock()
			}
		}()
	}
	wg.Wait()

	result := make([]ConsumerGroupTopicSummary, len(entries))
	for i, e := range entries {
		result[i] = ConsumerGroupTopicSummary{GroupID: e.groupID, Topic: e.topic, TotalLag: e.lag}
	}
	return result, nil
}

func DeleteConsumerGroup(cluster *models.KafkaCluster, groupID string) error {
	cfg, err := newSaramaConfig(cluster)
	if err != nil {
		return err
	}
	admin, err := sarama.NewClusterAdmin(clusterBrokers(cluster), cfg)
	if err != nil {
		return err
	}
	defer admin.Close()
	return admin.DeleteConsumerGroup(groupID)
}

func GetConsumerGroupDetail(cluster *models.KafkaCluster, groupID string) (*ConsumerGroupDetail, error) {
	cfg, err := newSaramaConfig(cluster)
	if err != nil {
		return nil, err
	}
	admin, err := sarama.NewClusterAdmin(clusterBrokers(cluster), cfg)
	if err != nil {
		return nil, err
	}
	defer admin.Close()

	client, err := sarama.NewClient(clusterBrokers(cluster), cfg)
	if err != nil {
		return nil, err
	}
	defer client.Close()

	descs, err := admin.DescribeConsumerGroups([]string{groupID})
	if err != nil || len(descs) == 0 {
		return nil, fmt.Errorf("describe group failed: %w", err)
	}
	d := descs[0]

	// Build partition→member mapping from member assignments
	type memberInfo struct{ clientID, clientHost, memberID string }
	partMember := make(map[string]map[int32]memberInfo) // topic → partition → member
	for _, m := range d.Members {
		assign, err := m.GetMemberAssignment()
		if err != nil || assign == nil {
			continue
		}
		for topic, partitions := range assign.Topics {
			if partMember[topic] == nil {
				partMember[topic] = make(map[int32]memberInfo)
			}
			for _, p := range partitions {
				partMember[topic][p] = memberInfo{clientID: m.ClientId, clientHost: m.ClientHost, memberID: m.MemberId}
			}
		}
	}

	// Get committed offsets
	offsetMap, err := admin.ListConsumerGroupOffsets(groupID, nil)
	if err != nil {
		return nil, fmt.Errorf("list offsets failed: %w", err)
	}

	topicsMap := make(map[string]*ConsumerGroupTopicDetail)
	for topic, partMap := range offsetMap.Blocks {
		td := &ConsumerGroupTopicDetail{Topic: topic}
		for partition, block := range partMap {
			p := int32(partition)
			earliest, _ := client.GetOffset(topic, p, sarama.OffsetOldest)
			latest, _ := client.GetOffset(topic, p, sarama.OffsetNewest)

			consumerOffset := block.Offset
			lag := int64(0)
			if consumerOffset >= 0 && latest > consumerOffset {
				lag = latest - consumerOffset
			}

			leaderID := int32(-1)
			if leader, err := client.Leader(topic, p); err == nil {
				leaderID = leader.ID()
			}

			mi := memberInfo{}
			if partMember[topic] != nil {
				mi = partMember[topic][p]
			}
			td.Partitions = append(td.Partitions, PartitionLagDetail{
				Partition:      p,
				Leader:         leaderID,
				LogStartOffset: earliest,
				LogEndOffset:   latest,
				ConsumerOffset: consumerOffset,
				Lag:            lag,
				ClientID:       mi.clientID,
				MemberID:       mi.memberID,
				ClientHost:     mi.clientHost,
			})
		}
		sort.Slice(td.Partitions, func(i, j int) bool {
			return td.Partitions[i].Partition < td.Partitions[j].Partition
		})
		topicsMap[topic] = td
	}

	topics := make([]ConsumerGroupTopicDetail, 0, len(topicsMap))
	for _, td := range topicsMap {
		topics = append(topics, *td)
	}
	sort.Slice(topics, func(i, j int) bool { return topics[i].Topic < topics[j].Topic })

	return &ConsumerGroupDetail{
		GroupID:  groupID,
		State:    d.State,
		Protocol: d.Protocol,
		Topics:   topics,
	}, nil
}

// PartitionOffsetChange describes the committed offset change for a single partition.
type PartitionOffsetChange struct {
	Partition    int32 `json:"partition"`
	BeforeOffset int64 `json:"before_offset"`
	AfterOffset  int64 `json:"after_offset"`
}

// ResetConsumerGroupOffsets resets committed offsets for a consumer group on a specific topic.
// resetType: "earliest" | "latest" | "timestamp" | "offset"
//   - "timestamp": timestampMs (Unix ms) must be > 0; resolves to first offset at or after that time.
//   - "offset": partitionOffsets must supply a target offset per partition.
//
// targetPartitions: nil/empty → reset all topic partitions; otherwise reset only the listed ones.
// partitionOffsets: only used when resetType == "offset"; maps partition ID → desired committed offset.
//
// Returns per-partition before/after offset information.
// The consumer group should be inactive (no running consumers) for the reset to take effect reliably.
func ResetConsumerGroupOffsets(cluster *models.KafkaCluster, groupID, topic, resetType string, timestampMs int64, targetPartitions []int32, partitionOffsets map[int32]int64) ([]PartitionOffsetChange, error) {
	cfg, err := newSaramaConfig(cluster)
	if err != nil {
		return nil, err
	}
	client, err := sarama.NewClient(clusterBrokers(cluster), cfg)
	if err != nil {
		return nil, fmt.Errorf("connect failed: %w", err)
	}
	defer client.Close()

	// Determine which partitions to operate on.
	var partitions []int32
	if len(targetPartitions) > 0 {
		partitions = targetPartitions
	} else {
		partitions, err = client.Partitions(topic)
		if err != nil {
			return nil, fmt.Errorf("get partitions for %q: %w", topic, err)
		}
	}

	var offsetTime int64
	switch resetType {
	case "latest":
		offsetTime = sarama.OffsetNewest
	case "timestamp":
		if timestampMs <= 0 {
			return nil, fmt.Errorf("timestamp_ms must be a positive Unix millisecond value")
		}
		offsetTime = timestampMs
	case "offset":
		// target offsets are supplied per-partition via partitionOffsets
	default: // "earliest"
		offsetTime = sarama.OffsetOldest
	}

	if err := client.RefreshCoordinator(groupID); err != nil {
		return nil, fmt.Errorf("refresh coordinator: %w", err)
	}
	coordinator, err := client.Coordinator(groupID)
	if err != nil {
		return nil, fmt.Errorf("get coordinator: %w", err)
	}

	// Fetch current committed offsets (before state).
	fetchReq := &sarama.OffsetFetchRequest{
		ConsumerGroup: groupID,
		Version:       1,
	}
	for _, p := range partitions {
		fetchReq.AddPartition(topic, p)
	}
	fetchResp, err := coordinator.FetchOffset(fetchReq)
	if err != nil {
		return nil, fmt.Errorf("fetch current offsets: %w", err)
	}

	commitReq := &sarama.OffsetCommitRequest{
		ConsumerGroup:           groupID,
		ConsumerGroupGeneration: -1, // admin/standalone commit, bypasses generation check
		ConsumerID:              "",
		RetentionTime:           -1, // use broker default retention
		Version:                 2,
	}

	changes := make([]PartitionOffsetChange, 0, len(partitions))
	for _, p := range partitions {
		// Capture before offset (-1 means no committed offset).
		beforeOffset := int64(-1)
		if topicBlocks, ok := fetchResp.Blocks[topic]; ok {
			if block, ok := topicBlocks[p]; ok {
				beforeOffset = block.Offset
			}
		}

		// Resolve target offset.
		var targetOffset int64
		if resetType == "offset" {
			var ok bool
			targetOffset, ok = partitionOffsets[p]
			if !ok {
				return nil, fmt.Errorf("no target offset provided for partition %d", p)
			}
		} else {
			targetOffset, err = client.GetOffset(topic, p, offsetTime)
			if err != nil {
				return nil, fmt.Errorf("get offset for partition %d: %w", p, err)
			}
		}

		commitReq.AddBlock(topic, p, targetOffset, 0, "")
		changes = append(changes, PartitionOffsetChange{
			Partition:    p,
			BeforeOffset: beforeOffset,
			AfterOffset:  targetOffset,
		})
	}

	resp, err := coordinator.CommitOffset(commitReq)
	if err != nil {
		return nil, fmt.Errorf("commit offsets: %w", err)
	}
	for p, kerr := range resp.Errors[topic] {
		if kerr != sarama.ErrNoError {
			return nil, fmt.Errorf("offset commit error for partition %d: %v", p, kerr)
		}
	}

	return changes, nil
}

// BrokerConfig represents a single Kafka configuration entry.
type BrokerConfig struct {
	Name        string `json:"name"`
	Value       string `json:"value"`
	IsDefault   bool   `json:"is_default"`
	ReadOnly    bool   `json:"read_only"`
	Sensitive   bool   `json:"sensitive"`
	Source      string `json:"source"`       // "broker" | "cluster" | "static" | "default" | "unknown"
	ClusterWide bool   `json:"cluster_wide"` // true = supports cluster-wide (default-broker) application
}

// BrokerConfigSnapshot holds the full config set for one broker.
type BrokerConfigSnapshot struct {
	BrokerID int32          `json:"broker_id"`
	Host     string         `json:"host"`
	Configs  []BrokerConfig `json:"configs"`
}

// GetAllBrokersConfigs fetches configs from every broker in parallel and returns
// one snapshot per broker, sorted by broker ID.
func GetAllBrokersConfigs(cluster *models.KafkaCluster) ([]BrokerConfigSnapshot, error) {
	cfg, err := newSaramaConfig(cluster)
	if err != nil {
		return nil, err
	}
	client, err := sarama.NewClient(clusterBrokers(cluster), cfg)
	if err != nil {
		return nil, err
	}
	defer client.Close()

	brokers := client.Brokers()
	if len(brokers) == 0 {
		return nil, fmt.Errorf("no brokers available")
	}

	admin, err := sarama.NewClusterAdminFromClient(client)
	if err != nil {
		return nil, err
	}
	defer admin.Close()

	type item struct {
		snap BrokerConfigSnapshot
		err  error
	}
	ch := make(chan item, len(brokers))
	for _, b := range brokers {
		b := b
		go func() {
			entries, err := admin.DescribeConfig(sarama.ConfigResource{
				Type:        sarama.BrokerResource,
				Name:        fmt.Sprintf("%d", b.ID()),
				ConfigNames: nil,
			})
			if err != nil {
				ch <- item{err: fmt.Errorf("broker %d: %w", b.ID(), err)}
				return
			}
			configs := make([]BrokerConfig, 0, len(entries))
			for _, e := range entries {
				configs = append(configs, BrokerConfig{
					Name:        e.Name,
					Value:       e.Value,
					IsDefault:   e.Default,
					ReadOnly:    e.ReadOnly,
					Sensitive:   e.Sensitive,
					Source:      brokerConfigSource(e.Source),
					ClusterWide: configSupportsClusterWide(e),
				})
			}
			ch <- item{snap: BrokerConfigSnapshot{
				BrokerID: b.ID(),
				Host:     b.Addr(),
				Configs:  configs,
			}}
		}()
	}

	snaps := make([]BrokerConfigSnapshot, 0, len(brokers))
	for range brokers {
		r := <-ch
		if r.err != nil {
			return nil, r.err
		}
		snaps = append(snaps, r.snap)
	}
	sort.Slice(snaps, func(i, j int) bool { return snaps[i].BrokerID < snaps[j].BrokerID })
	return snaps, nil
}

func GetClusterConfigs(cluster *models.KafkaCluster, brokerID int32) ([]BrokerConfig, error) {
	cfg, err := newSaramaConfig(cluster)
	if err != nil {
		return nil, err
	}
	client, err := sarama.NewClient(clusterBrokers(cluster), cfg)
	if err != nil {
		return nil, err
	}
	defer client.Close()

	brokers := client.Brokers()
	if len(brokers) == 0 {
		return nil, fmt.Errorf("no brokers available")
	}

	admin, err := sarama.NewClusterAdminFromClient(client)
	if err != nil {
		return nil, err
	}
	defer admin.Close()

	targetID := brokerID
	if targetID < 0 {
		targetID = brokers[0].ID()
	}
	entries, err := admin.DescribeConfig(sarama.ConfigResource{
		Type:        sarama.BrokerResource,
		Name:        fmt.Sprintf("%d", targetID),
		ConfigNames: nil,
	})
	if err != nil {
		return nil, err
	}

	result := make([]BrokerConfig, 0, len(entries))
	for _, e := range entries {
		result = append(result, BrokerConfig{
			Name:        e.Name,
			Value:       e.Value,
			IsDefault:   e.Default,
			ReadOnly:    e.ReadOnly,
			Sensitive:   e.Sensitive,
			Source:      brokerConfigSource(e.Source),
			ClusterWide: configSupportsClusterWide(e),
		})
	}
	return result, nil
}

func brokerConfigSource(s sarama.ConfigSource) string {
	switch s {
	case sarama.SourceDynamicBroker:
		return "broker"
	case sarama.SourceDynamicDefaultBroker:
		return "cluster"
	case sarama.SourceStaticBroker:
		return "static"
	case sarama.SourceDefault:
		return "default"
	default:
		return "unknown"
	}
}

// configSupportsClusterWide reports whether a config entry can be set at the
// cluster-wide (default-broker) level. Kafka always includes a
// SourceDynamicDefaultBroker synonym for such configs, even when no cluster-wide
// value is currently set. If synonyms are absent (older Kafka / older protocol
// version), we default to true so the UI doesn't block the user.
func configSupportsClusterWide(e sarama.ConfigEntry) bool {
	if len(e.Synonyms) == 0 {
		return true // older protocol: can't determine, allow cluster-wide
	}
	for _, s := range e.Synonyms {
		if s.Source == sarama.SourceDynamicDefaultBroker {
			return true
		}
	}
	return false
}

// UpdateClusterConfig applies a dynamic config change to the specified broker.
// Pass brokerID=-1 to apply cluster-wide (default-broker entity).
// Pass configValue=nil to reset the key to its default.
func UpdateClusterConfig(cluster *models.KafkaCluster, configName string, configValue *string, brokerID int32) error {
	cfg, err := newSaramaConfig(cluster)
	if err != nil {
		return err
	}
	client, err := sarama.NewClient(clusterBrokers(cluster), cfg)
	if err != nil {
		return err
	}
	defer client.Close()

	admin, err := sarama.NewClusterAdminFromClient(client)
	if err != nil {
		return err
	}
	defer admin.Close()

	deleteEntry := map[string]sarama.IncrementalAlterConfigsEntry{
		configName: {Operation: sarama.IncrementalAlterConfigsOperationDelete},
	}

	if brokerID >= 0 {
		// ── Per-broker path ──────────────────────────────────────────────────
		if configValue == nil {
			return admin.IncrementalAlterConfig(sarama.BrokerResource,
				fmt.Sprintf("%d", brokerID), deleteEntry, false)
		}
		return admin.IncrementalAlterConfig(sarama.BrokerResource,
			fmt.Sprintf("%d", brokerID),
			map[string]sarama.IncrementalAlterConfigsEntry{
				configName: {Operation: sarama.IncrementalAlterConfigsOperationSet, Value: configValue},
			}, false)
	}

	// ── Cluster-wide path ─────────────────────────────────────────────────
	// Per-broker overrides (SourceDynamicBroker) take precedence over the
	// cluster-wide default entity (SourceDynamicDefaultBroker). If any broker
	// has a stale per-broker override, the cluster-wide change would not take
	// effect on that broker. Clear per-broker overrides on every broker first
	// so they all fall through to the cluster-wide value.
	for _, b := range client.Brokers() {
		_ = admin.IncrementalAlterConfig(sarama.BrokerResource,
			fmt.Sprintf("%d", b.ID()), deleteEntry, false)
	}

	if configValue == nil {
		// Reset: also remove the cluster-wide default so brokers revert to static/default.
		return admin.IncrementalAlterConfig(sarama.BrokerResource, "", deleteEntry, false)
	}
	// Use IncrementalAlterConfig SET (not legacy AlterConfig) to avoid implicitly
	// removing other cluster-wide keys, which Kafka rejects when ELR is enabled.
	return admin.IncrementalAlterConfig(sarama.BrokerResource, "",
		map[string]sarama.IncrementalAlterConfigsEntry{
			configName: {Operation: sarama.IncrementalAlterConfigsOperationSet, Value: configValue},
		}, false)
}

// GetTopicConfig returns all configuration entries for the given topic.
func GetTopicConfig(cluster *models.KafkaCluster, topicName string) ([]BrokerConfig, error) {
	cfg, err := newSaramaConfig(cluster)
	if err != nil {
		return nil, err
	}
	admin, err := sarama.NewClusterAdmin(clusterBrokers(cluster), cfg)
	if err != nil {
		return nil, err
	}
	defer admin.Close()

	entries, err := admin.DescribeConfig(sarama.ConfigResource{
		Type:        sarama.TopicResource,
		Name:        topicName,
		ConfigNames: nil,
	})
	if err != nil {
		return nil, err
	}

	result := make([]BrokerConfig, 0, len(entries))
	for _, e := range entries {
		result = append(result, BrokerConfig{
			Name:      e.Name,
			Value:     e.Value,
			IsDefault: e.Default,
			ReadOnly:  e.ReadOnly,
			Sensitive: e.Sensitive,
		})
	}
	return result, nil
}

// UpdateTopicConfig applies a dynamic config change to a topic.
// Pass configValue=nil to reset the key to its default.
func UpdateTopicConfig(cluster *models.KafkaCluster, topicName, configName string, configValue *string) error {
	cfg, err := newSaramaConfig(cluster)
	if err != nil {
		return err
	}
	admin, err := sarama.NewClusterAdmin(clusterBrokers(cluster), cfg)
	if err != nil {
		return err
	}
	defer admin.Close()

	if configValue == nil {
		// Use IncrementalAlterConfigs DELETE to properly reset to broker default;
		// AlterConfig with null is rejected for INT/LONG typed configs (e.g. segment.bytes).
		return admin.IncrementalAlterConfig(sarama.TopicResource, topicName,
			map[string]sarama.IncrementalAlterConfigsEntry{
				configName: {Operation: sarama.IncrementalAlterConfigsOperationDelete},
			}, false)
	}
	return admin.AlterConfig(sarama.TopicResource, topicName,
		map[string]*string{configName: configValue}, false)
}

// GetClusterVersion connects to the cluster and infers the Kafka version
// from the API versions reported by a broker.
func GetClusterVersion(cluster *models.KafkaCluster) (string, error) {
	cfg, err := newSaramaConfig(cluster)
	if err != nil {
		return "", err
	}
	client, err := sarama.NewClient(clusterBrokers(cluster), cfg)
	if err != nil {
		return "", fmt.Errorf("connect failed: %w", err)
	}
	defer client.Close()

	broker := client.LeastLoadedBroker()
	if broker == nil {
		return "unknown", nil
	}

	resp, err := broker.ApiVersions(&sarama.ApiVersionsRequest{})
	if err != nil || resp.ErrorCode != 0 {
		return "unknown", nil
	}

	return inferKafkaVersion(resp.ApiKeys), nil
}

// inferKafkaVersion estimates the Kafka broker version from its supported API versions.
// Uses Fetch (key 1) and Produce (key 0) max versions as indicators.
func inferKafkaVersion(apiKeys []sarama.ApiVersionsResponseKey) string {
	m := make(map[int16]int16, len(apiKeys))
	for _, k := range apiKeys {
		m[k.ApiKey] = k.MaxVersion
	}
	f := m[1] // Fetch API max version
	p := m[0] // Produce API max version

	switch {
	case f >= 16:
		return ">= 3.6"
	case f >= 14:
		return "3.3 – 3.5"
	case f >= 13:
		return "3.2.x"
	case f >= 12 || p >= 9:
		return "2.8 – 3.1"
	case f >= 11 || p >= 8:
		return "2.4 – 2.7"
	case p >= 7:
		return "2.1 – 2.3"
	case p >= 5:
		return "1.0 – 2.0"
	case p >= 3:
		return "0.11.x"
	default:
		return "0.10.x"
	}
}

// ---- Message Fetch ----

// KafkaMessage represents a single Kafka message.
type KafkaMessage struct {
	Partition int32  `json:"partition"`
	Offset    int64  `json:"offset"`
	Timestamp string `json:"timestamp"`
	Key       string `json:"key"`
	Value     string `json:"value"`
	Size      int    `json:"size"`
}

// FetchMessages retrieves up to count messages from topic.
//
//   - mode "time"  : fetches from ALL partitions starting at the first offset
//     at or after timestampMs (Unix ms), then sorts by time and returns the
//     first count results.
//   - mode "offset": fetches count messages from the given partition starting
//     at startOffset.
//
// count is capped at 1000. Each partition consumer times out after 5 s.
func FetchMessages(cluster *models.KafkaCluster, topic, mode string,
	timestampMs int64, partition int32, startOffset int64, count int,
) ([]KafkaMessage, error) {
	if count <= 0 {
		count = 20
	}
	if count > 1000 {
		count = 1000
	}

	cfg, err := newSaramaConfig(cluster)
	if err != nil {
		return nil, err
	}
	cfg.Consumer.Return.Errors = true

	client, err := sarama.NewClient(clusterBrokers(cluster), cfg)
	if err != nil {
		return nil, fmt.Errorf("connect failed: %w", err)
	}
	defer client.Close()

	consumer, err := sarama.NewConsumerFromClient(client)
	if err != nil {
		return nil, fmt.Errorf("create consumer: %w", err)
	}
	defer consumer.Close()

	type target struct {
		partition int32
		offset    int64
	}
	var targets []target

	if mode == "time" {
		partitions, err := client.Partitions(topic)
		if err != nil {
			return nil, fmt.Errorf("list partitions: %w", err)
		}
		for _, p := range partitions {
			off, err := client.GetOffset(topic, p, timestampMs)
			if err != nil {
				continue
			}
			latest, _ := client.GetOffset(topic, p, sarama.OffsetNewest)
			if off >= latest {
				continue // no messages at or after the requested time
			}
			targets = append(targets, target{p, off})
		}
		if len(targets) == 0 {
			return []KafkaMessage{}, nil
		}
	} else {
		earliest, _ := client.GetOffset(topic, partition, sarama.OffsetOldest)
		latest, _ := client.GetOffset(topic, partition, sarama.OffsetNewest)
		if startOffset < earliest {
			startOffset = earliest
		}
		if startOffset >= latest {
			return []KafkaMessage{}, nil
		}
		targets = []target{{partition, startOffset}}
	}

	perPartition := count
	if len(targets) > 1 {
		perPartition = (count + len(targets) - 1) / len(targets)
	}

	var (
		mu  sync.Mutex
		all []KafkaMessage
		wg  sync.WaitGroup
	)
	for _, t := range targets {
		wg.Add(1)
		go func(p int32, off int64) {
			defer wg.Done()
			msgs := drainPartition(consumer, topic, p, off, perPartition, 5*time.Second)
			mu.Lock()
			all = append(all, msgs...)
			mu.Unlock()
		}(t.partition, t.offset)
	}
	wg.Wait()

	sort.Slice(all, func(i, j int) bool {
		if all[i].Timestamp != all[j].Timestamp {
			return all[i].Timestamp < all[j].Timestamp
		}
		if all[i].Partition != all[j].Partition {
			return all[i].Partition < all[j].Partition
		}
		return all[i].Offset < all[j].Offset
	})
	if len(all) > count {
		all = all[:count]
	}
	return all, nil
}

func drainPartition(consumer sarama.Consumer, topic string, partition int32, offset int64, maxCount int, timeout time.Duration) []KafkaMessage {
	pc, err := consumer.ConsumePartition(topic, partition, offset)
	if err != nil {
		return nil
	}
	defer pc.Close()

	var msgs []KafkaMessage
	deadline := time.After(timeout)
	for len(msgs) < maxCount {
		select {
		case msg, ok := <-pc.Messages():
			if !ok {
				return msgs
			}
			key := ""
			if msg.Key != nil {
				key = string(msg.Key)
			}
			val := ""
			if msg.Value != nil {
				val = string(msg.Value)
			}
			msgs = append(msgs, KafkaMessage{
				Partition: msg.Partition,
				Offset:    msg.Offset,
				Timestamp: msg.Timestamp.Format("2006-01-02 15:04:05.000"),
				Key:       key,
				Value:     val,
				Size:      len(msg.Key) + len(msg.Value),
			})
		case <-deadline:
			return msgs
		}
	}
	return msgs
}
