//go:build !prod

package main

import "github.com/gin-gonic/gin"

// setupStaticFiles is a no-op in development mode.
// The frontend is served by the Vite dev server (port 3000).
func setupStaticFiles(_ *gin.Engine) {}
