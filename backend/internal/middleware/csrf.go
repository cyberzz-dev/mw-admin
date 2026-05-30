package middleware

import (
	"net/http"

	ginsessions "github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
)

// CSRFProtect validates the X-CSRF-Token header for all state-changing requests
// (POST / PUT / DELETE / PATCH). GET, HEAD, and OPTIONS are exempted.
//
// The expected token is stored in the session under the key "csrf_token" and is
// issued to the client at login time via the response body. The client must echo
// it back in the X-CSRF-Token request header.
func CSRFProtect() gin.HandlerFunc {
	safe := map[string]bool{
		http.MethodGet:     true,
		http.MethodHead:    true,
		http.MethodOptions: true,
	}
	return func(c *gin.Context) {
		if safe[c.Request.Method] {
			c.Next()
			return
		}
		sess := ginsessions.Default(c)
		expected, _ := sess.Get("csrf_token").(string)
		got := c.GetHeader("X-CSRF-Token")
		if expected == "" || got == "" || expected != got {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "invalid CSRF token"})
			return
		}
		c.Next()
	}
}
