package session

import (
	"encoding/gob"
	"log"
	"net/http"

	"mw-admin/internal/config"

	ginsessions "github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/memstore"
	redisstore "github.com/gin-contrib/sessions/redis"
)

// Name is the session cookie name.
const Name = "mw_session"

func init() {
	// Register uint so gorilla/securecookie can gob-encode session data
	// that contains a user_id of type uint (needed for Redis store).
	gob.Register(uint(0))
}

// Init creates and returns the appropriate session store based on config.
// Use the returned store with gin-contrib/sessions middleware.
func Init() ginsessions.Store {
	cfg := config.Global
	secret := []byte(cfg.Auth.JWTSecret)

	opts := ginsessions.Options{
		Path:     "/",
		MaxAge:   cfg.Auth.JWTExpireHours * 3600,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	}

	if cfg.Redis.Enabled {
		store, err := redisstore.NewStore(cfg.Redis.PoolSize, "tcp", cfg.Redis.Addr, "", cfg.Redis.Password, secret)
		if err != nil {
			log.Fatalf("session: init redis store at %s: %v", cfg.Redis.Addr, err)
		}
		store.Options(opts)
		log.Printf("session store: redis (%s)", cfg.Redis.Addr)
		return store
	}

	store := memstore.NewStore(secret)
	store.Options(opts)
	log.Printf("session store: in-memory")
	return store
}
