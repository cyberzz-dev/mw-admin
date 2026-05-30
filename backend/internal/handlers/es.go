package handlers

import (
	"fmt"
	"io"
	"log"
	"mw-admin/internal/db"
	"mw-admin/internal/models"
	"mw-admin/internal/services"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

func ListESClusters(c *gin.Context) {
	role, _ := c.Get("role")
	viewScope, _ := c.Get("view_scope")
	userID, _ := c.Get("user_id")

	query := db.DB.Preload("Nodes")
	if role != "admin" && viewScope == "own" {
		query = query.Where("created_by = ?", userID)
	}
	var clusters []models.ESCluster
	query.Find(&clusters)
	for i := range clusters {
		clusters[i].Password = ""
	}
	c.JSON(http.StatusOK, clusters)
}

func CreateESCluster(c *gin.Context) {
	var cluster models.ESCluster
	if err := c.ShouldBindJSON(&cluster); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if cluster.Scheme == "" {
		cluster.Scheme = "http"
	}
	userID, _ := c.Get("user_id")
	cluster.CreatedBy = userID.(uint)
	if err := db.DB.Create(&cluster).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := services.RegisterESCluster(&cluster); err != nil {
		log.Printf("[consul] register es %q: %v", cluster.Name, err)
	}
	cluster.Password = ""
	c.JSON(http.StatusCreated, cluster)
}

func GetESCluster(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var cluster models.ESCluster
	if err := db.DB.Preload("Nodes").First(&cluster, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, cluster)
}

func UpdateESCluster(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var cluster models.ESCluster
	if err := db.DB.Preload("Nodes").First(&cluster, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	var input models.ESCluster
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// Deregister old consul services while old nodes are still in memory
	services.DeregisterESCluster(&cluster)
	db.DB.Where("cluster_id = ?", id).Delete(&models.ESNode{})
	cluster.Name = input.Name
	cluster.Description = input.Description
	cluster.Username = input.Username
	cluster.Scheme = input.Scheme
	cluster.MetricPort = input.MetricPort
	if input.Password != "" {
		cluster.Password = input.Password
	}
	cluster.Nodes = input.Nodes
	db.DB.Save(&cluster)
	if err := services.RegisterESCluster(&cluster); err != nil {
		log.Printf("[consul] register es %q: %v", cluster.Name, err)
	}
	cluster.Password = ""
	c.JSON(http.StatusOK, cluster)
}

func DeleteESCluster(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var cluster models.ESCluster
	if err := db.DB.Preload("Nodes").First(&cluster, uint(id)).Error; err == nil {
		services.DeregisterESCluster(&cluster)
	}
	db.DB.Delete(&models.ESCluster{}, id)
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

// ESConsulRegister manually (re-)registers an ES cluster in Consul.
func ESConsulRegister(c *gin.Context) {
	cluster, ok := getESCluster(c)
	if !ok {
		return
	}
	if err := services.RegisterESCluster(cluster); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "registered"})
}

// ESConsulDeregister manually deregisters an ES cluster from Consul.
func ESConsulDeregister(c *gin.Context) {
	cluster, ok := getESCluster(c)
	if !ok {
		return
	}
	services.DeregisterESCluster(cluster)
	c.JSON(http.StatusOK, gin.H{"message": "deregistered"})
}

func getESCluster(c *gin.Context) (*models.ESCluster, bool) {
	id, _ := strconv.Atoi(c.Param("id"))
	var cluster models.ESCluster
	if err := db.DB.Preload("Nodes").First(&cluster, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
		return nil, false
	}
	return &cluster, true
}

func ESListIndices(c *gin.Context) {
	cluster, ok := getESCluster(c)
	if !ok {
		return
	}
	indices, err := services.ListESIndices(cluster)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, indices)
}

func ESListNodes(c *gin.Context) {
	cluster, ok := getESCluster(c)
	if !ok {
		return
	}
	nodes, err := services.ListESNodes(cluster)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, nodes)
}

func ESListTemplates(c *gin.Context) {
	cluster, ok := getESCluster(c)
	if !ok {
		return
	}
	templates, err := services.ListESTemplates(cluster)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, templates)
}

func ESListILMPolicies(c *gin.Context) {
	cluster, ok := getESCluster(c)
	if !ok {
		return
	}
	policies, err := services.ListESILMPolicies(cluster)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, policies)
}

// ---- Index operations ----

func ESDeleteIndex(c *gin.Context) {
	cluster, ok := getESCluster(c)
	if !ok {
		return
	}
	indexName := c.Query("index")
	if indexName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "index is required"})
		return
	}
	if err := services.DeleteESIndex(cluster, indexName); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func ESBulkDeleteIndices(c *gin.Context) {
	cluster, ok := getESCluster(c)
	if !ok {
		return
	}
	var req struct {
		Indices []string `json:"indices"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var errs []string
	for _, idx := range req.Indices {
		if err := services.DeleteESIndex(cluster, idx); err != nil {
			errs = append(errs, fmt.Sprintf("%s: %s", idx, err.Error()))
		}
	}
	if len(errs) > 0 {
		c.JSON(http.StatusInternalServerError, gin.H{"error": strings.Join(errs, "; ")})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func ESCloseIndex(c *gin.Context) {
	cluster, ok := getESCluster(c)
	if !ok {
		return
	}
	indexName := c.Query("index")
	if indexName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "index is required"})
		return
	}
	if err := services.CloseESIndex(cluster, indexName); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "closed"})
}

func ESOpenIndex(c *gin.Context) {
	cluster, ok := getESCluster(c)
	if !ok {
		return
	}
	indexName := c.Query("index")
	if indexName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "index is required"})
		return
	}
	if err := services.OpenESIndex(cluster, indexName); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "opened"})
}

func ESBulkCloseIndices(c *gin.Context) {
	cluster, ok := getESCluster(c)
	if !ok {
		return
	}
	var req struct {
		Indices []string `json:"indices"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var errs []string
	for _, idx := range req.Indices {
		if err := services.CloseESIndex(cluster, idx); err != nil {
			errs = append(errs, fmt.Sprintf("%s: %s", idx, err.Error()))
		}
	}
	if len(errs) > 0 {
		c.JSON(http.StatusInternalServerError, gin.H{"error": strings.Join(errs, "; ")})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "closed"})
}

func ESGetIndexMapping(c *gin.Context) {
	cluster, ok := getESCluster(c)
	if !ok {
		return
	}
	indexName := c.Query("index")
	if indexName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "index is required"})
		return
	}
	data, err := services.GetESIndexMapping(cluster, indexName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, data)
}

func ESGetIndexSettings(c *gin.Context) {
	cluster, ok := getESCluster(c)
	if !ok {
		return
	}
	indexName := c.Query("index")
	if indexName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "index is required"})
		return
	}
	data, err := services.GetESIndexSettings(cluster, indexName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, data)
}

func ESPutIndexMapping(c *gin.Context) {
	cluster, ok := getESCluster(c)
	if !ok {
		return
	}
	indexName := c.Query("index")
	if indexName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "index is required"})
		return
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := services.PutESIndexMapping(cluster, indexName, body); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "updated"})
}

func ESPutIndexSettings(c *gin.Context) {
	cluster, ok := getESCluster(c)
	if !ok {
		return
	}
	indexName := c.Query("index")
	if indexName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "index is required"})
		return
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := services.PutESIndexSettings(cluster, indexName, body); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "updated"})
}

// ---- Component Template operations ----

func ESListComponentTemplates(c *gin.Context) {
	cluster, ok := getESCluster(c)
	if !ok {
		return
	}
	templates, err := services.ListESComponentTemplates(cluster)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, templates)
}

func ESDeleteComponentTemplate(c *gin.Context) {
	cluster, ok := getESCluster(c)
	if !ok {
		return
	}
	name := c.Query("name")
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}
	if err := services.DeleteESComponentTemplate(cluster, name); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func ESBulkDeleteComponentTemplates(c *gin.Context) {
	cluster, ok := getESCluster(c)
	if !ok {
		return
	}
	var req struct {
		Names []string `json:"names"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var errs []string
	for _, n := range req.Names {
		if err := services.DeleteESComponentTemplate(cluster, n); err != nil {
			errs = append(errs, fmt.Sprintf("%s: %s", n, err.Error()))
		}
	}
	if len(errs) > 0 {
		c.JSON(http.StatusInternalServerError, gin.H{"error": strings.Join(errs, "; ")})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func ESPutComponentTemplate(c *gin.Context) {
	cluster, ok := getESCluster(c)
	if !ok {
		return
	}
	name := c.Param("name")
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := services.PutESComponentTemplate(cluster, name, body); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "saved"})
}

// ---- Template operations ----

func ESDeleteTemplate(c *gin.Context) {
	cluster, ok := getESCluster(c)
	if !ok {
		return
	}
	name := c.Query("name")
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}
	if err := services.DeleteESTemplate(cluster, name); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func ESBulkDeleteTemplates(c *gin.Context) {
	cluster, ok := getESCluster(c)
	if !ok {
		return
	}
	var req struct {
		Names []string `json:"names"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var errs []string
	for _, n := range req.Names {
		if err := services.DeleteESTemplate(cluster, n); err != nil {
			errs = append(errs, fmt.Sprintf("%s: %s", n, err.Error()))
		}
	}
	if len(errs) > 0 {
		c.JSON(http.StatusInternalServerError, gin.H{"error": strings.Join(errs, "; ")})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func ESPutTemplate(c *gin.Context) {
	cluster, ok := getESCluster(c)
	if !ok {
		return
	}
	name := c.Param("name")
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := services.PutESTemplate(cluster, name, body); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "saved"})
}

// ---- ILM operations ----

func ESDeleteILMPolicy(c *gin.Context) {
	cluster, ok := getESCluster(c)
	if !ok {
		return
	}
	name := c.Query("name")
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}
	if err := services.DeleteESILMPolicy(cluster, name); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func ESBulkDeleteILMPolicies(c *gin.Context) {
	cluster, ok := getESCluster(c)
	if !ok {
		return
	}
	var req struct {
		Names []string `json:"names"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var errs []string
	for _, n := range req.Names {
		if err := services.DeleteESILMPolicy(cluster, n); err != nil {
			errs = append(errs, fmt.Sprintf("%s: %s", n, err.Error()))
		}
	}
	if len(errs) > 0 {
		c.JSON(http.StatusInternalServerError, gin.H{"error": strings.Join(errs, "; ")})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func ESPutILMPolicy(c *gin.Context) {
	cluster, ok := getESCluster(c)
	if !ok {
		return
	}
	name := c.Param("name")
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := services.PutESILMPolicy(cluster, name, body); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "saved"})
}

func ESDevConsole(c *gin.Context) {
	cluster, ok := getESCluster(c)
	if !ok {
		return
	}
	var req struct {
		Method string `json:"method"`
		Path   string `json:"path"`
		Body   string `json:"body"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Method == "" {
		req.Method = "GET"
	}
	result, err := services.ESDevConsole(cluster, req.Method, req.Path, []byte(req.Body))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}
