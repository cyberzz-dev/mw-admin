package handlers

import (
	"crypto/rand"
	"encoding/base64"
	"mw-admin/internal/db"
	"mw-admin/internal/models"
	"mw-admin/internal/services"
	"net/http"

	ginsessions "github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
)

func generateCSRFToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.StdEncoding.EncodeToString(b)
}

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

	csrfToken := generateCSRFToken()

	sess := ginsessions.Default(c)
	sess.Clear()
	sess.Set("user_id", user.ID)
	sess.Set("username", user.Username)
	sess.Set("role", user.Role)
	sess.Set("permissions", user.Permissions)
	sess.Set("view_scope", user.ViewScope)
	sess.Set("component_access", user.ComponentAccess)
	sess.Set("csrf_token", csrfToken)
	if err := sess.Save(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "session save failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"csrf_token": csrfToken,
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

func Logout(c *gin.Context) {
	sess := ginsessions.Default(c)
	sess.Clear()
	sess.Options(ginsessions.Options{MaxAge: -1})
	if err := sess.Save(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "logout failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "logged out"})
}

func GetMe(c *gin.Context) {
	sess := ginsessions.Default(c)
	csrfToken, _ := sess.Get("csrf_token").(string)
	c.JSON(http.StatusOK, gin.H{
		"id":               c.GetUint("user_id"),
		"username":         c.GetString("username"),
		"role":             c.GetString("role"),
		"permissions":      c.GetString("permissions"),
		"view_scope":       c.GetString("view_scope"),
		"component_access": c.GetString("component_access"),
		"csrf_token":       csrfToken,
	})
}
