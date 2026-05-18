//go:build prod

package main

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

//go:embed web/dist
var webFS embed.FS

// setupStaticFiles serves the embedded frontend for all non-API routes,
// with SPA fallback to index.html.
func setupStaticFiles(r *gin.Engine) {
	distFS, err := fs.Sub(webFS, "web/dist")
	if err != nil {
		panic("failed to sub web/dist: " + err.Error())
	}
	fileServer := http.FileServer(http.FS(distFS))

	// Pre-read index.html to avoid http.FileServer's /index.html → / redirect loop.
	indexHTML, err := fs.ReadFile(distFS, "index.html")
	if err != nil {
		panic("web/dist/index.html not found in embed: " + err.Error())
	}

	r.NoRoute(func(c *gin.Context) {
		path := strings.TrimLeft(c.Request.URL.Path, "/")

		// Serve real static assets (JS, CSS, images…) via FileServer.
		// Skip "index.html" itself — FileServer would redirect it back to "/".
		if path != "" && path != "index.html" {
			if _, err := fs.Stat(distFS, path); err == nil {
				fileServer.ServeHTTP(c.Writer, c.Request)
				return
			}
		}

		// SPA fallback: serve index.html content directly (no redirect).
		c.Data(http.StatusOK, "text/html; charset=utf-8", indexHTML)
	})
}
