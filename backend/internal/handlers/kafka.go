package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"mw-admin/internal/db"
	"mw-admin/internal/models"
	"mw-admin/internal/services"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// ---- Cluster CRUD ----

func ListKafkaClusters(c *gin.Context) {
	role, _ := c.Get("role")
	viewScope, _ := c.Get("view_scope")
	userID, _ := c.Get("user_id")

	query := db.DB.Preload("Nodes")
	if role != "admin" && viewScope == "own" {
		query = query.Where("created_by = ?", userID)
	}
	var clusters []models.KafkaCluster
	query.Find(&clusters)
	// mask passwords
	for i := range clusters {
		clusters[i].Password = ""
	}
	c.JSON(http.StatusOK, clusters)
}

func CreateKafkaCluster(c *gin.Context) {
	var cluster models.KafkaCluster
	if err := c.ShouldBindJSON(&cluster); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	userID, _ := c.Get("user_id")
	cluster.CreatedBy = userID.(uint)
	if err := db.DB.Create(&cluster).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := services.RegisterKafkaCluster(&cluster); err != nil {
		log.Printf("[consul] register kafka %q: %v", cluster.Name, err)
	}
	cluster.Password = ""
	c.JSON(http.StatusCreated, cluster)
}

func GetKafkaCluster(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var cluster models.KafkaCluster
	if err := db.DB.Preload("Nodes").First(&cluster, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, cluster)
}

func UpdateKafkaCluster(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var cluster models.KafkaCluster
	if err := db.DB.Preload("Nodes").First(&cluster, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	var input models.KafkaCluster
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// Deregister old consul services before nodes are replaced
	services.DeregisterKafkaCluster(&cluster)
	// delete existing nodes then recreate
	db.DB.Where("cluster_id = ?", id).Delete(&models.KafkaNode{})
	cluster.Name = input.Name
	cluster.Description = input.Description
	cluster.Version = input.Version
	cluster.AuthType = input.AuthType
	cluster.Username = input.Username
	cluster.MetricPort = input.MetricPort
	if input.Password != "" {
		cluster.Password = input.Password
	}
	cluster.Nodes = input.Nodes
	db.DB.Save(&cluster)
	if err := services.RegisterKafkaCluster(&cluster); err != nil {
		log.Printf("[consul] register kafka %q: %v", cluster.Name, err)
	}
	cluster.Password = ""
	c.JSON(http.StatusOK, cluster)
}

func DeleteKafkaCluster(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var cluster models.KafkaCluster
	if err := db.DB.Preload("Nodes").First(&cluster, uint(id)).Error; err == nil {
		services.DeregisterKafkaCluster(&cluster)
	}
	db.DB.Delete(&models.KafkaCluster{}, id)
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

// KafkaConsulRegister manually (re-)registers a Kafka cluster in Consul.
func KafkaConsulRegister(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	if err := services.RegisterKafkaCluster(cluster); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "registered"})
}

// KafkaConsulDeregister manually deregisters a Kafka cluster from Consul.
func KafkaConsulDeregister(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	services.DeregisterKafkaCluster(cluster)
	c.JSON(http.StatusOK, gin.H{"message": "deregistered"})
}

// ---- Topic management ----

func getKafkaCluster(c *gin.Context) (*models.KafkaCluster, bool) {
	id, _ := strconv.Atoi(c.Param("id"))
	var cluster models.KafkaCluster
	if err := db.DB.Preload("Nodes").First(&cluster, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
		return nil, false
	}
	return &cluster, true
}

func KafkaListTopics(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	topics, err := services.GetTopics(cluster)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, topics)
}

func KafkaGetTopicDiskSizes(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	sizes, err := services.GetTopicDiskSizes(cluster)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, sizes)
}

func KafkaGetTopicDetail(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	topicName := c.Param("topic")
	detail, err := services.GetTopicDetail(cluster, topicName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, detail)
}

func KafkaCreateTopic(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	var req struct {
		Name       string `json:"name"`
		Partitions int32  `json:"partitions"`
		Replicas   int16  `json:"replicas"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := services.CreateTopic(cluster, req.Name, req.Partitions, req.Replicas); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "topic created"})
}

func KafkaDeleteTopic(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	topicName := c.Param("topic")
	if err := services.DeleteTopic(cluster, topicName); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func KafkaAdjustReplication(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	topicName := c.Param("topic")
	var req struct {
		Replicas int `json:"replicas"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := services.AdjustReplication(cluster, topicName, req.Replicas); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "副本调整已提交，请稍候生效"})
}

func KafkaListBrokers(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	brokers, err := services.ListClusterBrokers(cluster)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, brokers)
}

func KafkaListBrokerPartitions(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	brokerID64, err := strconv.ParseInt(c.Param("brokerID"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid broker id"})
		return
	}
	partitions, err := services.ListBrokerPartitions(cluster, int32(brokerID64))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, partitions)
}

func KafkaGetTopicAssignment(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	topicName := c.Param("topic")
	assignment, err := services.GetTopicAssignment(cluster, topicName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, assignment)
}

func KafkaApplyAssignment(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	topicName := c.Param("topic")
	var body json.RawMessage
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var req struct {
		Assignment          map[string][]int32 `json:"assignment"`
		ThrottleBytesPerSec int64              `json:"throttle_bytes_per_sec"`
	}
	if err := json.Unmarshal(body, &req); err == nil && req.Assignment != nil {
		assignment, ok := parseAssignment(c, req.Assignment)
		if !ok {
			return
		}
		userID, _ := c.Get("user_id")
		task, err := services.SubmitReplicaAssignment(cluster, topicName, assignment, req.ThrottleBytesPerSec, userID.(uint))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, task)
		return
	}

	var raw map[string][]int32
	if err := json.Unmarshal(body, &raw); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	assignment, ok := parseAssignment(c, raw)
	if !ok {
		return
	}
	if err := services.ApplyAssignment(cluster, topicName, assignment); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Replica adjustment submitted. Kafka is reassigning partitions in the background."})
}

func parseAssignment(c *gin.Context, raw map[string][]int32) (map[int32][]int32, bool) {
	assignment := make(map[int32][]int32, len(raw))
	for k, v := range raw {
		id, err := strconv.Atoi(k)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid partition ID: " + k})
			return nil, false
		}
		assignment[int32(id)] = v
	}
	return assignment, true
}

func KafkaMigratePartitions(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	topicName := c.Param("topic")
	var req struct {
		SrcBroker           int32   `json:"src_broker"`
		DstBroker           int32   `json:"dst_broker"`
		ThrottleBytesPerSec int64   `json:"throttle_bytes_per_sec"`
		Partitions          []int32 `json:"partitions"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	userID, _ := c.Get("user_id")
	task, err := services.SubmitPartitionMigration(cluster, topicName, req.SrcBroker, req.DstBroker, req.Partitions, req.ThrottleBytesPerSec, userID.(uint))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, task)
}

func KafkaListReassignmentTasks(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	tasks, err := services.ListReassignmentTasks(cluster.ID, c.Query("topic"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, tasks)
}

func KafkaVerifyReassignmentTask(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	taskID64, err := strconv.ParseUint(c.Param("taskID"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid task id"})
		return
	}
	task, err := services.VerifyReassignmentTask(cluster, uint(taskID64))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, task)
}

func KafkaCancelReassignmentTask(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	taskID64, err := strconv.ParseUint(c.Param("taskID"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid task id"})
		return
	}
	task, err := services.CancelReassignmentTask(cluster, uint(taskID64))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, task)
}

func KafkaUpdateTopicPartitions(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	topicName := c.Param("topic")
	var req struct {
		Partitions int32 `json:"partitions"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := services.UpdateTopicPartitions(cluster, topicName, req.Partitions); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "partitions updated"})
}

// ---- Consumer Groups ----

func KafkaListConsumerGroups(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	groups, err := services.ListConsumerGroups(cluster)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, groups)
}

func KafkaGetClusterVersion(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	version, err := services.GetClusterVersion(cluster)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"version": version})
}

func KafkaDeleteConsumerGroup(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	groupID := c.Param("group")
	if err := services.DeleteConsumerGroup(cluster, groupID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func KafkaGetConsumerGroupDetail(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	groupID := c.Param("group")
	detail, err := services.GetConsumerGroupDetail(cluster, groupID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, detail)
}

func KafkaResetConsumerGroupOffsets(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	groupID := c.Param("group")
	var req struct {
		Topic            string           `json:"topic" binding:"required"`
		ResetType        string           `json:"reset_type" binding:"required,oneof=earliest latest timestamp offset"`
		TimestampMs      int64            `json:"timestamp_ms"`
		Partitions       []int32          `json:"partitions"`        // nil/empty = all partitions
		PartitionOffsets map[string]int64 `json:"partition_offsets"` // for reset_type=offset
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// Convert string-keyed partition_offsets to int32 keys.
	partitionOffsets := make(map[int32]int64, len(req.PartitionOffsets))
	for k, v := range req.PartitionOffsets {
		pid, err := strconv.Atoi(k)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("invalid partition key %q: %v", k, err)})
			return
		}
		partitionOffsets[int32(pid)] = v
	}
	changes, err := services.ResetConsumerGroupOffsets(cluster, groupID, req.Topic, req.ResetType, req.TimestampMs, req.Partitions, partitionOffsets)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "offsets reset successfully", "changes": changes})
}

// ---- Cluster Config ----

func KafkaGetClusterConfig(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	brokerID := int32(-1)
	if v := c.Query("broker_id"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			brokerID = int32(n)
		}
	}
	configs, err := services.GetClusterConfigs(cluster, brokerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, configs)
}

// KafkaGetAllBrokersConfig fetches configs from all brokers in parallel and
// returns a per-broker snapshot list for cross-broker comparison.
func KafkaGetAllBrokersConfig(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	snaps, err := services.GetAllBrokersConfigs(cluster)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, snaps)
}

func KafkaUpdateClusterConfig(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	var req struct {
		Name     string  `json:"name"`
		Value    *string `json:"value"`     // nil resets to default
		BrokerID int32   `json:"broker_id"` // -1 = all brokers
	}
	req.BrokerID = -1 // default: all brokers
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "配置名称不能为空"})
		return
	}
	if err := services.UpdateClusterConfig(cluster, req.Name, req.Value, req.BrokerID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "配置已更新"})
}

func KafkaFetchMessages(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	topic := c.Param("topic")
	var req struct {
		Mode        string `json:"mode" binding:"required,oneof=time offset"`
		TimestampMs int64  `json:"timestamp_ms"`
		Partition   int32  `json:"partition"`
		StartOffset int64  `json:"start_offset"`
		Count       int    `json:"count"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	msgs, err := services.FetchMessages(cluster, topic, req.Mode, req.TimestampMs, req.Partition, req.StartOffset, req.Count)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, msgs)
}

func KafkaGetTopicConfig(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	topicName := c.Param("topic")
	configs, err := services.GetTopicConfig(cluster, topicName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, configs)
}

func KafkaUpdateTopicConfig(c *gin.Context) {
	cluster, ok := getKafkaCluster(c)
	if !ok {
		return
	}
	topicName := c.Param("topic")
	var req struct {
		Name  string  `json:"name"`
		Value *string `json:"value"` // nil resets to default
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "配置名称不能为空"})
		return
	}
	if err := services.UpdateTopicConfig(cluster, topicName, req.Name, req.Value); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "配置已更新"})
}
