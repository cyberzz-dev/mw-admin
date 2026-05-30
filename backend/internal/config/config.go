package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// Config is the top-level application configuration.
type Config struct {
	Server   ServerConfig   `yaml:"server"`
	Database DatabaseConfig `yaml:"database"`
	Auth     AuthConfig     `yaml:"auth"`
	Redis    RedisConfig    `yaml:"redis"`
	Consul   ConsulConfig   `yaml:"consul"`
}

// ServerConfig controls the HTTP server.
type ServerConfig struct {
	Port int    `yaml:"port"` // default: 8080
	Mode string `yaml:"mode"` // debug | release (default: release)
}

// DatabaseConfig selects and configures the persistence backend.
type DatabaseConfig struct {
	Driver string     `yaml:"driver"` // sqlite | mysql  (default: sqlite)
	DSN    string     `yaml:"dsn"`    // SQLite: file path; MySQL: full DSN string
	Pool   PoolConfig `yaml:"pool"`
}

// PoolConfig controls the sql.DB connection pool (applies to both drivers).
type PoolConfig struct {
	MaxOpenConns    int `yaml:"max_open_conns"`     // default: 25
	MaxIdleConns    int `yaml:"max_idle_conns"`     // default: 10
	ConnMaxLifetime int `yaml:"conn_max_lifetime"`  // seconds, default: 3600
	ConnMaxIdleTime int `yaml:"conn_max_idle_time"` // seconds, default: 600
}

// AuthConfig controls authentication / token settings.
type AuthConfig struct {
	JWTSecret      string `yaml:"jwt_secret"`       // default: mw-admin-jwt-secret-change-in-prod
	JWTExpireHours int    `yaml:"jwt_expire_hours"` // default: 24
}

// RedisConfig holds Redis connection settings.
// Redis is not yet used internally but is provided for future integration.
type RedisConfig struct {
	Enabled  bool   `yaml:"enabled"`   // default: false
	Addr     string `yaml:"addr"`      // default: 127.0.0.1:6379
	Password string `yaml:"password"`  // default: ""
	DB       int    `yaml:"db"`        // default: 0
	PoolSize int    `yaml:"pool_size"` // default: 10
}

// ConsulConfig holds Consul agent connection settings for service registration.
type ConsulConfig struct {
	Enabled bool   `yaml:"enabled"` // default: false
	Addr    string `yaml:"addr"`    // default: 127.0.0.1:8500  (http://host:port also accepted)
	Token   string `yaml:"token"`   // ACL token; leave empty if ACLs are disabled
	DC      string `yaml:"dc"`      // datacenter override; leave empty to use agent default
}

// Global is the application-wide configuration instance, populated by Load.
var Global *Config

// Load reads a YAML config file from path. If path is empty it tries
// "config.yaml" in the working directory. Missing file is not an error;
// built-in defaults are used instead.  Environment variables always
// override file values (see applyEnvOverrides).
func Load(path string) error {
	cfg := defaultConfig()
	if path == "" {
		path = "config.yaml"
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			applyEnvOverrides(cfg)
			Global = cfg
			return nil
		}
		return fmt.Errorf("read config %q: %w", path, err)
	}
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return fmt.Errorf("parse config %q: %w", path, err)
	}
	applyEnvOverrides(cfg)
	Global = cfg
	return nil
}

func defaultConfig() *Config {
	return &Config{
		Server: ServerConfig{
			Port: 8080,
			Mode: "release",
		},
		Database: DatabaseConfig{
			Driver: "sqlite",
			DSN:    "mw-admin.db",
			Pool: PoolConfig{
				MaxOpenConns:    25,
				MaxIdleConns:    10,
				ConnMaxLifetime: 3600,
				ConnMaxIdleTime: 600,
			},
		},
		Auth: AuthConfig{
			JWTSecret:      "mw-admin-jwt-secret-change-in-prod",
			JWTExpireHours: 24,
		},
		Redis: RedisConfig{
			Enabled:  false,
			Addr:     "127.0.0.1:6379",
			DB:       0,
			PoolSize: 10,
		},
		Consul: ConsulConfig{
			Enabled: false,
			Addr:    "127.0.0.1:8500",
		},
	}
}

// applyEnvOverrides lets environment variables shadow YAML values.
func applyEnvOverrides(cfg *Config) {
	if v := os.Getenv("JWT_SECRET"); v != "" {
		cfg.Auth.JWTSecret = v
	}
	if v := os.Getenv("DB_DRIVER"); v != "" {
		cfg.Database.Driver = v
	}
	if v := os.Getenv("DB_DSN"); v != "" {
		cfg.Database.DSN = v
	}
}
