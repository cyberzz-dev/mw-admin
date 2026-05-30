package middleware

import (
	"encoding/json"
	"mw-admin/internal/db"
	"net/http"
	"strconv"

	ginsessions "github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
)

func AuthRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		sess := ginsessions.Default(c)
		userID, ok := sess.Get("user_id").(uint)
		if !ok || userID == 0 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		viewScope, _ := sess.Get("view_scope").(string)
		if viewScope == "" {
			viewScope = "all"
		}
		c.Set("user_id", userID)
		c.Set("username", sess.Get("username").(string))
		c.Set("role", sess.Get("role").(string))
		c.Set("permissions", sess.Get("permissions"))
		c.Set("view_scope", viewScope)
		c.Set("component_access", sess.Get("component_access"))
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
