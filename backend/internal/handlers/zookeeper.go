package handlers

import (
	"mw-admin/internal/db"
	"mw-admin/internal/models"
	"mw-admin/internal/services"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// ---- ZK Cluster CRUD ----

func ListZKClusters(c *gin.Context) {
	role, _ := c.Get("role")
	viewScope, _ := c.Get("view_scope")
	userID, _ := c.Get("user_id")

	query := db.DB
	if role != "admin" && viewScope == "own" {
		query = query.Where("created_by = ?", userID)
	}
	var clusters []models.ZKCluster
	query.Find(&clusters)
	for i := range clusters {
		clusters[i].Password = ""
	}
	c.JSON(http.StatusOK, clusters)
}

func CreateZKCluster(c *gin.Context) {
	var cluster models.ZKCluster
	if err := c.ShouldBindJSON(&cluster); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if cluster.AuthScheme == "" {
		cluster.AuthScheme = "none"
	}
	userID, _ := c.Get("user_id")
	cluster.CreatedBy = userID.(uint)
	if err := db.DB.Create(&cluster).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	cluster.Password = ""
	c.JSON(http.StatusCreated, cluster)
}

func GetZKCluster(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var cluster models.ZKCluster
	if err := db.DB.First(&cluster, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, cluster)
}

func UpdateZKCluster(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var cluster models.ZKCluster
	if err := db.DB.First(&cluster, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	var input models.ZKCluster
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	cluster.Name = input.Name
	cluster.Description = input.Description
	cluster.Servers = input.Servers
	cluster.AuthScheme = input.AuthScheme
	cluster.SASLMechanism = input.SASLMechanism
	cluster.Username = input.Username
	if input.Password != "" {
		cluster.Password = input.Password
	}
	db.DB.Save(&cluster)
	cluster.Password = ""
	c.JSON(http.StatusOK, cluster)
}

func DeleteZKCluster(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	db.DB.Delete(&models.ZKCluster{}, id)
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

// ---- ZK Operations ----

func getZKCluster(c *gin.Context) (*models.ZKCluster, bool) {
	id, _ := strconv.Atoi(c.Param("id"))
	var cluster models.ZKCluster
	if err := db.DB.First(&cluster, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
		return nil, false
	}
	return &cluster, true
}

// ZKListChildren returns sorted, paginated children of a path.
// Query: path, offset, limit
func ZKListChildren(c *gin.Context) {
	cluster, ok := getZKCluster(c)
	if !ok {
		return
	}
	path := c.DefaultQuery("path", "/")
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "200"))
	if limit <= 0 || limit > 1000 {
		limit = 200
	}

	result, err := services.ZKListChildren(cluster, path, offset, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}

// ZKGetNode returns data, stat, and ACLs for a path.
// Query: path
func ZKGetNode(c *gin.Context) {
	cluster, ok := getZKCluster(c)
	if !ok {
		return
	}
	path := c.Query("path")
	if path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path is required"})
		return
	}

	info, err := services.ZKGetNode(cluster, path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, info)
}

// ZKCreateNode creates a new znode.
// Body: { path, data, flags, acls }
func ZKCreateNode(c *gin.Context) {
	cluster, ok := getZKCluster(c)
	if !ok {
		return
	}
	var req services.ZKCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	created, err := services.ZKCreateNode(cluster, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"path": created})
}

// ZKSetNodeData updates the data of an existing znode.
// Body: { path, data, version }
func ZKSetNodeData(c *gin.Context) {
	cluster, ok := getZKCluster(c)
	if !ok {
		return
	}
	var body struct {
		Path    string `json:"path"`
		Data    string `json:"data"`
		Version int32  `json:"version"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := services.ZKSetNodeData(cluster, body.Path, body.Data, body.Version); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "updated"})
}

// ZKDeleteNode deletes a znode.
// Query: path, version (default -1), recursive (default false)
func ZKDeleteNode(c *gin.Context) {
	cluster, ok := getZKCluster(c)
	if !ok {
		return
	}
	path := c.Query("path")
	if path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path is required"})
		return
	}

	if c.Query("recursive") == "true" {
		if err := services.ZKDeleteNodeRecursive(cluster, path); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	} else {
		ver, _ := strconv.ParseInt(c.DefaultQuery("version", "-1"), 10, 32)
		if err := services.ZKDeleteNode(cluster, path, int32(ver)); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

// ZKGetStats returns server-level statistics via the mntr four-letter command.
func ZKGetStats(c *gin.Context) {
	cluster, ok := getZKCluster(c)
	if !ok {
		return
	}
	stats, err := services.ZKGetStats(cluster)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, stats)
}

// ZKSetACL replaces the ACL on a znode.
// Body: { path, acls, version }
func ZKSetACL(c *gin.Context) {
	cluster, ok := getZKCluster(c)
	if !ok {
		return
	}
	var body struct {
		Path    string           `json:"path"`
		ACLs    []services.ZKACL `json:"acls"`
		Version int32            `json:"version"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := services.ZKSetACL(cluster, body.Path, body.ACLs, body.Version); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "acl updated"})
}
