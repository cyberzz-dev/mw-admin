package models

import (
	"time"
)

// KafkaCluster represents a Kafka cluster configuration
type KafkaCluster struct {
	ID            uint        `json:"id" gorm:"primaryKey;autoIncrement"`
	Name          string      `json:"name" gorm:"uniqueIndex;not null"`
	Description   string      `json:"description"`
	Version       string      `json:"version"`
	AuthType      string      `json:"auth_type"` // PLAINTEXT, SASL_PLAIN, SCRAM-SHA-256, SCRAM-SHA-512, SSL_SCRAM-SHA-256, SSL_SCRAM-SHA-512
	Username      string      `json:"username"`
	Password      string      `json:"password,omitempty" gorm:"column:password"`
	TLSSkipVerify bool        `json:"tls_skip_verify" gorm:"default:true"`
	TLSCACert     string      `json:"tls_ca_cert,omitempty" gorm:"type:text"`
	CreatedBy     uint        `json:"created_by"`
	CreatedAt     time.Time   `json:"created_at"`
	UpdatedAt     time.Time   `json:"updated_at"`
	Nodes         []KafkaNode `json:"nodes" gorm:"foreignKey:ClusterID;constraint:OnDelete:CASCADE"`
}

// KafkaNode represents a single Kafka broker node
type KafkaNode struct {
	ID        uint   `json:"id" gorm:"primaryKey;autoIncrement"`
	ClusterID uint   `json:"cluster_id"`
	Host      string `json:"host"`
	Port      int    `json:"port"`
}

// ESCluster represents an Elasticsearch cluster configuration
type ESCluster struct {
	ID          uint      `json:"id" gorm:"primaryKey;autoIncrement"`
	Name        string    `json:"name" gorm:"uniqueIndex;not null"`
	Description string    `json:"description"`
	Username    string    `json:"username"`
	Password    string    `json:"password,omitempty" gorm:"column:password"`
	Scheme      string    `json:"scheme"` // http or https
	CreatedBy   uint      `json:"created_by"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	Nodes       []ESNode  `json:"nodes" gorm:"foreignKey:ClusterID;constraint:OnDelete:CASCADE"`
}

// ESNode represents a single ES node
type ESNode struct {
	ID        uint   `json:"id" gorm:"primaryKey;autoIncrement"`
	ClusterID uint   `json:"cluster_id"`
	Host      string `json:"host"`
	Port      int    `json:"port"`
}

// ZKCluster represents a ZooKeeper cluster configuration
type ZKCluster struct {
	ID            uint      `json:"id" gorm:"primaryKey;autoIncrement"`
	Name          string    `json:"name" gorm:"uniqueIndex;not null"`
	Description   string    `json:"description"`
	Servers       string    `json:"servers"`        // comma-separated host:port, e.g. "host1:2181,host2:2181"
	AuthScheme    string    `json:"auth_scheme"`    // none | digest | sasl
	SASLMechanism string    `json:"sasl_mechanism"` // PLAIN | DIGEST-MD5 (only used when AuthScheme=sasl)
	Username      string    `json:"username"`
	Password      string    `json:"password,omitempty" gorm:"column:password"`
	CreatedBy     uint      `json:"created_by"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// User represents a platform user
type User struct {
	ID          uint      `json:"id" gorm:"primaryKey;autoIncrement"`
	Username    string    `json:"username" gorm:"uniqueIndex;not null"`
	Password    string    `json:"-" gorm:"column:password;not null"`
	Role        string    `json:"role" gorm:"default:'user'"`      // admin | user
	Permissions string    `json:"permissions" gorm:"type:text"`    // JSON array of permission strings
	ViewScope   string    `json:"view_scope" gorm:"default:'all'"` // all | own
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
