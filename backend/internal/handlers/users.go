package handlers

import (
	"mw-admin/internal/db"
	"mw-admin/internal/models"
	"mw-admin/internal/services"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

func ListUsers(c *gin.Context) {
	var users []models.User
	db.DB.Find(&users)
	c.JSON(http.StatusOK, users)
}

func CreateUser(c *gin.Context) {
	var req struct {
		Username    string `json:"username"`
		Password    string `json:"password"`
		Role        string `json:"role"`
		Permissions string `json:"permissions"`
		ViewScope   string `json:"view_scope"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Username == "" || req.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "用户名和密码不能为空"})
		return
	}
	hash, err := services.HashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	role := req.Role
	if role == "" {
		role = "user"
	}
	viewScope := req.ViewScope
	if viewScope == "" {
		viewScope = "all"
	}
	user := models.User{
		Username:    req.Username,
		Password:    hash,
		Role:        role,
		Permissions: req.Permissions,
		ViewScope:   viewScope,
	}
	if err := db.DB.Create(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, user)
}

func UpdateUser(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var user models.User
	if err := db.DB.First(&user, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}
	var req struct {
		Username    string `json:"username"`
		Password    string `json:"password"`
		Role        string `json:"role"`
		Permissions string `json:"permissions"`
		ViewScope   string `json:"view_scope"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Username != "" {
		user.Username = req.Username
	}
	user.Role = req.Role
	user.Permissions = req.Permissions
	if req.ViewScope != "" {
		user.ViewScope = req.ViewScope
	}
	if req.Password != "" {
		hash, err := services.HashPassword(req.Password)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		user.Password = hash
	}
	db.DB.Save(&user)
	c.JSON(http.StatusOK, user)
}

func DeleteUser(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	// prevent deleting the last admin
	var adminCount int64
	db.DB.Model(&models.User{}).Where("role = ?", "admin").Count(&adminCount)
	var target models.User
	if err := db.DB.First(&target, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}
	if target.Role == "admin" && adminCount <= 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不能删除最后一个管理员"})
		return
	}
	db.DB.Delete(&models.User{}, id)
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}
