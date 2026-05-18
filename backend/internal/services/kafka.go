package services

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"mw-admin/internal/models"
	"sort"
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
	ID   int32  `json:"id"`
	Addr string `json:"addr"`
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
	result := make([]BrokerInfo, len(brokers))
	for i, b := range brokers {
		result[i] = BrokerInfo{ID: b.ID(), Addr: b.Addr()}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
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
// Pass brokerID=-1 to apply to every broker in the cluster.
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

	if configValue == nil {
		// Use IncrementalAlterConfigs DELETE to properly reset to broker default;
		// AlterConfig with null is rejected for INT/LONG typed configs (e.g. segment.bytes).
		incrEntries := map[string]sarama.IncrementalAlterConfigsEntry{
			configName: {Operation: sarama.IncrementalAlterConfigsOperationDelete},
		}
		if brokerID >= 0 {
			return admin.IncrementalAlterConfig(sarama.BrokerResource,
				fmt.Sprintf("%d", brokerID), incrEntries, false)
		}
		// cluster-wide: reset on the default-broker entity (inherited by all brokers)
		return admin.IncrementalAlterConfig(sarama.BrokerResource, "", incrEntries, false)
	}
	entries := map[string]*string{configName: configValue}
	if brokerID >= 0 {
		// Apply to a single broker
		return admin.AlterConfig(sarama.BrokerResource,
			fmt.Sprintf("%d", brokerID), entries, false)
	}
	// cluster-wide: write to the default-broker entity (inherited by all brokers)
	return admin.AlterConfig(sarama.BrokerResource, "", entries, false)
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
			})
		case <-deadline:
			return msgs
		}
	}
	return msgs
}
