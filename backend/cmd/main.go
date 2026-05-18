package main

import (
	"mw-admin/internal/db"
	"mw-admin/internal/handlers"
	"mw-admin/internal/middleware"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	gin.SetMode(gin.ReleaseMode)
	db.Init("mw-admin.db")

	r := gin.Default()
	r.Use(cors.New(cors.Config{
		AllowAllOrigins:  true,
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		AllowCredentials: false,
	}))

	api := r.Group("/api")

	// Public: auth
	api.POST("/auth/login", handlers.Login)

	// All routes below require a valid JWT
	auth := api.Group("", middleware.AuthRequired())
	auth.GET("/auth/me", handlers.GetMe)

	// User management (admin only)
	users := auth.Group("/users", middleware.AdminRequired())
	users.GET("", handlers.ListUsers)
	users.POST("", handlers.CreateUser)
	users.PUT("/:id", handlers.UpdateUser)
	users.DELETE("/:id", handlers.DeleteUser)

	// Kafka cluster CRUD
	kafka := auth.Group("/kafka")
	kafka.GET("/clusters", handlers.ListKafkaClusters)
	kafka.POST("/clusters", middleware.PermissionRequired("kafka_cluster_add"), handlers.CreateKafkaCluster)
	kafka.GET("/clusters/:id", handlers.GetKafkaCluster)
	kafka.PUT("/clusters/:id", middleware.PermissionOrOwnerRequired("kafka_cluster_edit", "kafka_clusters"), handlers.UpdateKafkaCluster)
	kafka.DELETE("/clusters/:id", middleware.PermissionOrOwnerRequired("kafka_cluster_delete", "kafka_clusters"), handlers.DeleteKafkaCluster)

	// Kafka topic management
	kafka.GET("/clusters/:id/topics", handlers.KafkaListTopics)
	kafka.GET("/clusters/:id/topics/sizes", handlers.KafkaGetTopicDiskSizes)
	kafka.POST("/clusters/:id/topics", middleware.PermissionOrOwnerRequired("kafka_topic_add", "kafka_clusters"), handlers.KafkaCreateTopic)
	kafka.GET("/clusters/:id/topics/:topic", handlers.KafkaGetTopicDetail)
	kafka.DELETE("/clusters/:id/topics/:topic", middleware.PermissionOrOwnerRequired("kafka_topic_delete", "kafka_clusters"), handlers.KafkaDeleteTopic)
	kafka.PUT("/clusters/:id/topics/:topic/partitions", middleware.PermissionOrOwnerRequired("kafka_topic_edit", "kafka_clusters"), handlers.KafkaUpdateTopicPartitions)
	kafka.PUT("/clusters/:id/topics/:topic/replication", middleware.PermissionOrOwnerRequired("kafka_topic_edit", "kafka_clusters"), handlers.KafkaAdjustReplication)
	kafka.GET("/clusters/:id/brokers", handlers.KafkaListBrokers)
	kafka.GET("/clusters/:id/topics/:topic/assignment", handlers.KafkaGetTopicAssignment)
	kafka.PUT("/clusters/:id/topics/:topic/assignment", middleware.PermissionOrOwnerRequired("kafka_topic_edit", "kafka_clusters"), handlers.KafkaApplyAssignment)
	kafka.PUT("/clusters/:id/topics/:topic/migrate", middleware.PermissionOrOwnerRequired("kafka_topic_edit", "kafka_clusters"), handlers.KafkaMigratePartitions)

	// Consumer groups
	kafka.GET("/clusters/:id/consumer-groups", handlers.KafkaListConsumerGroups)
	kafka.GET("/clusters/:id/consumer-groups/:group", handlers.KafkaGetConsumerGroupDetail)
	kafka.DELETE("/clusters/:id/consumer-groups/:group", middleware.PermissionOrOwnerRequired("kafka_consumer_group_delete", "kafka_clusters"), handlers.KafkaDeleteConsumerGroup)
	kafka.POST("/clusters/:id/consumer-groups/:group/reset-offsets", middleware.PermissionOrOwnerRequired("kafka_consumer_group_delete", "kafka_clusters"), handlers.KafkaResetConsumerGroupOffsets)

	// Cluster config and version
	kafka.GET("/clusters/:id/config", handlers.KafkaGetClusterConfig)
	kafka.PUT("/clusters/:id/config", middleware.PermissionOrOwnerRequired("kafka_cluster_edit", "kafka_clusters"), handlers.KafkaUpdateClusterConfig)
	kafka.GET("/clusters/:id/version", handlers.KafkaGetClusterVersion)

	// Topic config
	kafka.GET("/clusters/:id/topics/:topic/config", handlers.KafkaGetTopicConfig)
	kafka.PUT("/clusters/:id/topics/:topic/config", middleware.PermissionOrOwnerRequired("kafka_topic_edit", "kafka_clusters"), handlers.KafkaUpdateTopicConfig)
	kafka.POST("/clusters/:id/topics/:topic/fetch-messages", handlers.KafkaFetchMessages)

	// ES cluster CRUD
	es := auth.Group("/es")
	es.GET("/clusters", handlers.ListESClusters)
	es.POST("/clusters", middleware.PermissionRequired("es_cluster_add"), handlers.CreateESCluster)
	es.GET("/clusters/:id", handlers.GetESCluster)
	es.PUT("/clusters/:id", middleware.PermissionOrOwnerRequired("es_cluster_edit", "es_clusters"), handlers.UpdateESCluster)
	es.DELETE("/clusters/:id", middleware.PermissionOrOwnerRequired("es_cluster_delete", "es_clusters"), handlers.DeleteESCluster)

	// ES operations
	es.GET("/clusters/:id/indices", handlers.ESListIndices)
	es.DELETE("/clusters/:id/indices", handlers.ESDeleteIndex)
	es.POST("/clusters/:id/indices/bulk-delete", handlers.ESBulkDeleteIndices)
	es.POST("/clusters/:id/indices/close", handlers.ESCloseIndex)
	es.POST("/clusters/:id/indices/open", handlers.ESOpenIndex)
	es.POST("/clusters/:id/indices/bulk-close", handlers.ESBulkCloseIndices)
	es.GET("/clusters/:id/indices/mapping", handlers.ESGetIndexMapping)
	es.PUT("/clusters/:id/indices/mapping", handlers.ESPutIndexMapping)
	es.GET("/clusters/:id/indices/settings", handlers.ESGetIndexSettings)
	es.PUT("/clusters/:id/indices/settings", handlers.ESPutIndexSettings)
	es.GET("/clusters/:id/nodes", handlers.ESListNodes)
	es.GET("/clusters/:id/templates", handlers.ESListTemplates)
	es.DELETE("/clusters/:id/templates", handlers.ESDeleteTemplate)
	es.POST("/clusters/:id/templates/bulk-delete", handlers.ESBulkDeleteTemplates)
	es.PUT("/clusters/:id/templates/:name", handlers.ESPutTemplate)
	es.GET("/clusters/:id/ilm", handlers.ESListILMPolicies)
	es.DELETE("/clusters/:id/ilm", handlers.ESDeleteILMPolicy)
	es.POST("/clusters/:id/ilm/bulk-delete", handlers.ESBulkDeleteILMPolicies)
	es.PUT("/clusters/:id/ilm/:name", handlers.ESPutILMPolicy)
	es.POST("/clusters/:id/console", handlers.ESDevConsole)

	// ZooKeeper cluster CRUD
	zkr := auth.Group("/zk")
	zkr.GET("/clusters", handlers.ListZKClusters)
	zkr.POST("/clusters", middleware.PermissionRequired("zk_cluster_add"), handlers.CreateZKCluster)
	zkr.GET("/clusters/:id", handlers.GetZKCluster)
	zkr.PUT("/clusters/:id", middleware.PermissionOrOwnerRequired("zk_cluster_edit", "zk_clusters"), handlers.UpdateZKCluster)
	zkr.DELETE("/clusters/:id", middleware.PermissionOrOwnerRequired("zk_cluster_delete", "zk_clusters"), handlers.DeleteZKCluster)

	// ZooKeeper znode operations
	zkr.GET("/clusters/:id/ls", handlers.ZKListChildren)
	zkr.GET("/clusters/:id/node", handlers.ZKGetNode)
	zkr.POST("/clusters/:id/node", middleware.PermissionOrOwnerRequired("zk_node_edit", "zk_clusters"), handlers.ZKCreateNode)
	zkr.PUT("/clusters/:id/node", middleware.PermissionOrOwnerRequired("zk_node_edit", "zk_clusters"), handlers.ZKSetNodeData)
	zkr.DELETE("/clusters/:id/node", middleware.PermissionOrOwnerRequired("zk_node_delete", "zk_clusters"), handlers.ZKDeleteNode)
	zkr.PUT("/clusters/:id/node/acl", middleware.PermissionOrOwnerRequired("zk_node_edit", "zk_clusters"), handlers.ZKSetACL)
	zkr.GET("/clusters/:id/stats", handlers.ZKGetStats)

	setupStaticFiles(r)

	r.Run(":8080")
}
