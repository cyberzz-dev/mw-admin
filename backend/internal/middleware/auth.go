package middleware

import (
	"encoding/json"
	"mw-admin/internal/db"
	"mw-admin/internal/services"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

func AuthRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
		claims, err := services.ParseToken(tokenStr)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}
		c.Set("user_id", claims.UserID)
		c.Set("username", claims.Username)
		c.Set("role", claims.Role)
		c.Set("permissions", claims.Permissions)
		viewScope := claims.ViewScope
		if viewScope == "" {
			viewScope = "all"
		}
		c.Set("view_scope", viewScope)
		c.Next()
	}
}

func AdminRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		role, _ := c.Get("role")
		if role != "admin" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "admin required"})
			return
		}
		c.Next()
	}
}

// PermissionRequired checks that the user has admin role OR the specific permission.
func PermissionRequired(perm string) gin.HandlerFunc {
	return PermissionOrOwnerRequired(perm, "")
}

// PermissionOrOwnerRequired checks admin role OR explicit permission OR cluster ownership.
// table is the DB table name (e.g. "kafka_clusters") used to verify ownership via the `:id` route param.
// Pass empty string to skip the ownership check.
func PermissionOrOwnerRequired(perm string, table string) gin.HandlerFunc {
	return func(c *gin.Context) {
		role, _ := c.Get("role")
		if role == "admin" {
			c.Next()
			return
		}
		permsStr, _ := c.Get("permissions")
		var perms []string
		if ps, ok := permsStr.(string); ok && ps != "" {
			_ = json.Unmarshal([]byte(ps), &perms)
		}
		for _, p := range perms {
			if p == perm {
				c.Next()
				return
			}
		}
		if table != "" {
			if clusterID, err := strconv.Atoi(c.Param("id")); err == nil {
				userID, _ := c.Get("user_id")
				var count int64
				db.DB.Table(table).
					Where("id = ? AND created_by = ?", clusterID, userID).
					Count(&count)
				if count > 0 {
					c.Next()
					return
				}
			}
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "permission denied"})
	}
}
