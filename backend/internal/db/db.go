package db

import (
	"log"
	"mw-admin/internal/config"
	"mw-admin/internal/models"
	"time"

	"github.com/glebarez/sqlite"
	"golang.org/x/crypto/bcrypt"
	mysqldriver "gorm.io/driver/mysql"
	"gorm.io/gorm"
)

var DB *gorm.DB

func Init() {
	cfg := config.Global.Database
	var err error

	switch cfg.Driver {
	case "mysql":
		DB, err = gorm.Open(mysqldriver.Open(cfg.DSN), &gorm.Config{})
		if err != nil {
			log.Fatalf("failed to connect MySQL: %v", err)
		}
	default: // sqlite
		DB, err = gorm.Open(sqlite.Open(cfg.DSN+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)&_pragma=cache_size(-64000)"), &gorm.Config{})
		if err != nil {
			log.Fatalf("failed to connect SQLite: %v", err)
		}
	}

	sqlDB, err := DB.DB()
	if err != nil {
		log.Fatalf("failed to get underlying sql.DB: %v", err)
	}
	sqlDB.SetMaxOpenConns(cfg.Pool.MaxOpenConns)
	sqlDB.SetMaxIdleConns(cfg.Pool.MaxIdleConns)
	sqlDB.SetConnMaxLifetime(time.Duration(cfg.Pool.ConnMaxLifetime) * time.Second)
	sqlDB.SetConnMaxIdleTime(time.Duration(cfg.Pool.ConnMaxIdleTime) * time.Second)

	err = DB.AutoMigrate(
		&models.KafkaCluster{},
		&models.KafkaNode{},
		&models.ESCluster{},
		&models.ESNode{},
		&models.ZKCluster{},
		&models.User{},
	)
	if err != nil {
		log.Fatalf("failed to migrate database: %v", err)
	}

	seedAdmin()
	log.Println("Database initialized")
}

// seedAdmin creates a default admin user if none exists.
func seedAdmin() {
	var count int64
	DB.Model(&models.User{}).Where("role = ?", "admin").Count(&count)
	if count > 0 {
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte("admin"), 12)
	if err != nil {
		log.Printf("failed to hash admin password: %v", err)
		return
	}
	admin := models.User{
		Username:    "admin",
		Password:    string(hash),
		Role:        "admin",
		Permissions: "[]",
	}
	if err := DB.Create(&admin).Error; err != nil {
		log.Printf("failed to seed admin user: %v", err)
		return
	}
	log.Println("Default admin user created (username: admin, password: admin)")
}
