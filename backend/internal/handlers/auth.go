package handlers

import (
	"mw-admin/internal/db"
	"mw-admin/internal/models"
	"mw-admin/internal/services"
	"net/http"

	"github.com/gin-gonic/gin"
)

func Login(c *gin.Context) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var user models.User
	if err := db.DB.Where("username = ?", req.Username).First(&user).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "用户名或密码错误"})
		return
	}

	if !services.CheckPassword(req.Password, user.Password) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "用户名或密码错误"})
		return
	}

	token, err := services.GenerateToken(user.ID, user.Username, user.Role, user.Permissions, user.ViewScope, user.ComponentAccess)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成令牌失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token": token,
		"user": gin.H{
			"id":               user.ID,
			"username":         user.Username,
			"role":             user.Role,
			"permissions":      user.Permissions,
			"view_scope":       user.ViewScope,
			"component_access": user.ComponentAccess,
		},
	})
}

func GetMe(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"id":               c.GetUint("user_id"),
		"username":         c.GetString("username"),
		"role":             c.GetString("role"),
		"permissions":      c.GetString("permissions"),
		"view_scope":       c.GetString("view_scope"),
		"component_access": c.GetString("component_access"),
	})
}
