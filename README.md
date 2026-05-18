# Middleware Admin Platform

**English** | [中文](#中文文档)

A web-based administration platform for managing Kafka, Elasticsearch, and ZooKeeper clusters. Built with a Go backend and a React/TypeScript frontend.

> **All-in-One** — ships as a **single self-contained binary** with the frontend embedded. No separate web server, no external database, no runtime dependencies. Drop the binary anywhere and run.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Build for Production](#build-for-production)
- [Authentication & Permissions](#authentication--permissions)
- [API Reference](#api-reference)
- [Default Credentials](#default-credentials)

---

## Features

### Kafka
- **Cluster Management** — Add, edit, delete clusters. Supports PLAINTEXT, SASL/PLAIN, SCRAM-SHA-256, SCRAM-SHA-512, and SSL variants. Multi-node configuration with TLS CA cert support.
- **Topic Management** — List topics with partition count, replica count, leader partitions, and disk size. Create topics, delete topics, view per-partition replica/ISR/offset detail.
- **Partition Operations** — Increase partition count, adjust replication factor (round-robin broker assignment), view/edit raw partition assignments, migrate partitions between brokers.
- **Topic Configuration** — View and dynamically update topic-level configs (e.g. `retention.ms`, `segment.bytes`). Reset individual keys to broker defaults.
- **Consumer Groups** — List all groups with per-topic lag summary. View per-partition lag detail including consumer offset, log end offset, member ID, client ID, and client host. Delete groups and reset offsets (earliest / latest / timestamp / specific offset).
- **Message Browsing** — Fetch messages by offset or by timestamp across all partitions.
- **Cluster Configuration** — View and update broker-level dynamic configs. Reset keys to defaults.
- **Version Detection** — Auto-detect Kafka broker version from reported API versions.

### Elasticsearch
- **Cluster Management** — Add, edit, delete clusters. Supports HTTP/HTTPS, username/password auth, TLS skip-verify, multi-node.
- **Index Management** — List indices with health, status, primary shards, replicas, doc count, and disk size (sortable by actual byte size). Open, close, delete, or bulk-delete/close indices.
- **Index Mapping & Settings** — View and edit index mapping and settings via JSON drawer.
- **Node List** — View nodes with roles, CPU usage, heap usage, disk available/total.
- **Index Templates** — List, create/update, delete, and bulk-delete index templates.
- **ILM Policies** — List, create/update, delete, and bulk-delete Index Lifecycle Management policies.
- **Dev Console** — Send raw HTTP requests to the ES cluster directly from the browser (method + path + JSON body).

### ZooKeeper
- **Cluster Management** — Add, edit, delete clusters. Supports DIGEST-MD5 SASL auth.
- **ZNode Browser** — Tree-style navigation of the ZNode hierarchy. View node data, stat metadata, and ACLs.
- **ZNode Operations** — Create, update data, delete znodes. Set ACL entries per node.
- **Cluster Stats** — View server stat output (`mntr` equivalent).

### User & Access Control
- **JWT Authentication** — Stateless JWT-based login. All API routes (except `/auth/login`) require a valid token.
- **Role-Based Access** — `admin` role has full access. Regular users are granted fine-grained permissions.
- **Permissions** — Per-action permissions: `kafka_cluster_add`, `kafka_topic_add`, `kafka_topic_edit`, `kafka_topic_delete`, `kafka_consumer_group_delete`, `es_cluster_add`, `es_cluster_edit`, `es_cluster_delete`, `zk_cluster_add`, `zk_node_edit`, `zk_node_delete`, etc.
- **Owner Access** — Cluster creators automatically have edit/delete rights on their own clusters without explicit permission grants.
- **User Management** — Admin-only: list, create, update, and delete users.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend language | Go 1.22+ |
| HTTP framework | [Gin](https://github.com/gin-gonic/gin) |
| ORM | [GORM](https://gorm.io) |
| Database | SQLite (embedded, no external DB needed) |
| Kafka client | [IBM/sarama](https://github.com/IBM/sarama) |
| ES client | [elastic/go-elasticsearch](https://github.com/elastic/go-elasticsearch) |
| ZooKeeper client | [go-zookeeper](https://github.com/go-zookeeper/zk) |
| Auth | JWT (golang-jwt/jwt) |
| Frontend framework | React 18 + TypeScript |
| UI library | [Ant Design 5](https://ant.design) |
| Build tool | [Vite](https://vitejs.dev) |

---

## Project Structure

```
mw-admin/
├── backend/
│   ├── cmd/
│   │   ├── main.go          # Entry point, route registration
│   │   ├── static_dev.go    # Dev mode: proxy to Vite
│   │   └── static_prod.go   # Prod mode: serve embedded frontend
│   ├── internal/
│   │   ├── db/              # SQLite init & auto-migrate
│   │   ├── handlers/        # HTTP handlers per domain
│   │   │   ├── auth.go
│   │   │   ├── es.go
│   │   │   ├── kafka.go
│   │   │   ├── users.go
│   │   │   └── zookeeper.go
│   │   ├── middleware/
│   │   │   └── auth.go      # JWT, permission, owner checks
│   │   ├── models/
│   │   │   └── models.go    # GORM models
│   │   └── services/        # Business logic
│   │       ├── auth.go
│   │       ├── es.go
│   │       ├── kafka.go
│   │       ├── scram.go     # SCRAM-SHA-256/512 client
│   │       ├── zk_sasl.go
│   │       └── zookeeper.go
│   └── go.mod
└── frontend/
    ├── src/
    │   ├── App.tsx           # Router, sidebar navigation
    │   ├── components/       # ClusterSelector, ResizableColumns, modals
    │   ├── contexts/
    │   │   └── AuthContext.tsx
    │   ├── pages/
    │   │   ├── auth/         # Login
    │   │   ├── es/           # ES pages
    │   │   ├── kafka/        # Kafka pages
    │   │   ├── users/        # User management
    │   │   └── zk/           # ZooKeeper pages
    │   └── services/
    │       └── api.ts        # Axios API wrappers
    ├── package.json
    └── vite.config.ts
```

---

## Quick Start

### Prerequisites

- Go 1.22+
- Node.js 18+ and npm

### Backend

```bash
cd backend
go run ./cmd/main.go
# API server starts at http://localhost:8080
```

### Frontend (development)

```bash
cd frontend
npm install
npm run dev
# Dev server starts at http://localhost:3000
```

Open `http://localhost:3000` in your browser.

---

## Build for Production

### Windows → Windows (`mw-admin.exe`)

```bat
build.bat
```

### Linux / macOS → same platform (`mw-admin`)

```bash
chmod +x build.sh
./build.sh
```

### Windows → Linux cross-compile (`mw-admin`)

```bat
:: Build for linux/amd64 (default)
build-linux.bat

:: Build for linux/arm64
build-linux.bat arm64
```

> Go's built-in cross-compilation is used (`GOOS=linux GOARCH=amd64 CGO_ENABLED=0`).  
> No extra toolchain or WSL is required — just Go and Node.js on Windows.

The build scripts:
1. Run `npm run build` in `frontend/` — outputs to `frontend/dist/`
2. Compile the Go backend with the frontend assets embedded via `go:embed`
3. Output a single self-contained binary `mw-admin` (or `mw-admin.exe`)

Run the binary directly:

```bash
./mw-admin
# Serves both API and frontend at http://localhost:8080
```

---

## Authentication & Permissions

All API routes except `POST /api/auth/login` require a JWT Bearer token in the `Authorization` header.

**Roles:**
- `admin` — full access to all operations including user management
- (regular) — access controlled by individual permission flags

**Permission flags** (set per user by an admin):

| Permission | Controls |
|---|---|
| `kafka_cluster_add` | Create Kafka clusters |
| `kafka_cluster_edit` | Edit/delete Kafka clusters |
| `kafka_cluster_delete` | Delete Kafka clusters |
| `kafka_topic_add` | Create topics |
| `kafka_topic_edit` | Edit partitions, replication, config, assignment |
| `kafka_topic_delete` | Delete topics |
| `kafka_consumer_group_delete` | Delete consumer groups, reset offsets |
| `es_cluster_add` | Create ES clusters |
| `es_cluster_edit` | Edit ES clusters |
| `es_cluster_delete` | Delete ES clusters |
| `zk_cluster_add` | Create ZooKeeper clusters |
| `zk_cluster_edit` | Edit ZooKeeper clusters |
| `zk_cluster_delete` | Delete ZooKeeper clusters |
| `zk_node_edit` | Create/update znodes and ACLs |
| `zk_node_delete` | Delete znodes |

> Cluster **owners** (the user who created a cluster) automatically have edit and delete rights on that cluster regardless of permission flags.

---

## API Reference

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Login, returns JWT token |
| GET | `/api/auth/me` | Current user info |

### Users (admin only)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users` | List all users |
| POST | `/api/users` | Create user |
| PUT | `/api/users/:id` | Update user (name, password, role, permissions) |
| DELETE | `/api/users/:id` | Delete user |

### Kafka — Clusters

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/kafka/clusters` | List clusters |
| POST | `/api/kafka/clusters` | Create cluster |
| GET | `/api/kafka/clusters/:id` | Get cluster detail |
| PUT | `/api/kafka/clusters/:id` | Update cluster |
| DELETE | `/api/kafka/clusters/:id` | Delete cluster |
| GET | `/api/kafka/clusters/:id/version` | Detected Kafka version |
| GET | `/api/kafka/clusters/:id/config` | Broker config entries |
| PUT | `/api/kafka/clusters/:id/config` | Update broker config key |
| GET | `/api/kafka/clusters/:id/brokers` | List brokers |

### Kafka — Topics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/kafka/clusters/:id/topics` | List topics (name, partitions, replicas, leader count) |
| GET | `/api/kafka/clusters/:id/topics/sizes` | Per-topic disk size in bytes |
| POST | `/api/kafka/clusters/:id/topics` | Create topic |
| GET | `/api/kafka/clusters/:id/topics/:topic` | Topic detail (per-partition replica, ISR, offsets, disk) |
| DELETE | `/api/kafka/clusters/:id/topics/:topic` | Delete topic |
| PUT | `/api/kafka/clusters/:id/topics/:topic/partitions` | Increase partition count |
| PUT | `/api/kafka/clusters/:id/topics/:topic/replication` | Change replication factor |
| GET | `/api/kafka/clusters/:id/topics/:topic/assignment` | Get partition→replica assignment |
| PUT | `/api/kafka/clusters/:id/topics/:topic/assignment` | Apply raw partition assignment |
| PUT | `/api/kafka/clusters/:id/topics/:topic/migrate` | Migrate partitions from one broker to another |
| GET | `/api/kafka/clusters/:id/topics/:topic/config` | Topic config entries |
| PUT | `/api/kafka/clusters/:id/topics/:topic/config` | Update topic config key |
| POST | `/api/kafka/clusters/:id/topics/:topic/fetch-messages` | Browse messages by offset or timestamp |

### Kafka — Consumer Groups

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/kafka/clusters/:id/consumer-groups` | List groups with per-topic lag |
| GET | `/api/kafka/clusters/:id/consumer-groups/:group` | Group detail: per-partition lag, member info |
| DELETE | `/api/kafka/clusters/:id/consumer-groups/:group` | Delete consumer group |
| POST | `/api/kafka/clusters/:id/consumer-groups/:group/reset-offsets` | Reset offsets (earliest/latest/timestamp/offset) |

### Elasticsearch — Clusters

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/es/clusters` | List clusters |
| POST | `/api/es/clusters` | Create cluster |
| GET | `/api/es/clusters/:id` | Get cluster detail |
| PUT | `/api/es/clusters/:id` | Update cluster |
| DELETE | `/api/es/clusters/:id` | Delete cluster |

### Elasticsearch — Indices

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/es/clusters/:id/indices` | List indices (health, status, shards, docs, size) |
| DELETE | `/api/es/clusters/:id/indices?index=NAME` | Delete single index |
| POST | `/api/es/clusters/:id/indices/bulk-delete` | Bulk delete indices |
| POST | `/api/es/clusters/:id/indices/close?index=NAME` | Close index |
| POST | `/api/es/clusters/:id/indices/open?index=NAME` | Open index |
| POST | `/api/es/clusters/:id/indices/bulk-close` | Bulk close indices |
| GET | `/api/es/clusters/:id/indices/mapping?index=NAME` | Get index mapping |
| PUT | `/api/es/clusters/:id/indices/mapping?index=NAME` | Update index mapping |
| GET | `/api/es/clusters/:id/indices/settings?index=NAME` | Get index settings |
| PUT | `/api/es/clusters/:id/indices/settings?index=NAME` | Update index settings |

### Elasticsearch — Other

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/es/clusters/:id/nodes` | List nodes (role, CPU, heap, disk) |
| GET | `/api/es/clusters/:id/templates` | List index templates |
| PUT | `/api/es/clusters/:id/templates/:name` | Create/update template |
| DELETE | `/api/es/clusters/:id/templates?name=NAME` | Delete template |
| POST | `/api/es/clusters/:id/templates/bulk-delete` | Bulk delete templates |
| GET | `/api/es/clusters/:id/ilm` | List ILM policies |
| PUT | `/api/es/clusters/:id/ilm/:name` | Create/update ILM policy |
| DELETE | `/api/es/clusters/:id/ilm?name=NAME` | Delete ILM policy |
| POST | `/api/es/clusters/:id/ilm/bulk-delete` | Bulk delete ILM policies |
| POST | `/api/es/clusters/:id/console` | Dev console (proxy arbitrary ES API calls) |

### ZooKeeper — Clusters

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/zk/clusters` | List clusters |
| POST | `/api/zk/clusters` | Create cluster |
| GET | `/api/zk/clusters/:id` | Get cluster detail |
| PUT | `/api/zk/clusters/:id` | Update cluster |
| DELETE | `/api/zk/clusters/:id` | Delete cluster |
| GET | `/api/zk/clusters/:id/stats` | Cluster stats |

### ZooKeeper — ZNodes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/zk/clusters/:id/ls?path=PATH` | List children of a znode |
| GET | `/api/zk/clusters/:id/node?path=PATH` | Get znode data, stat, and ACLs |
| POST | `/api/zk/clusters/:id/node` | Create znode |
| PUT | `/api/zk/clusters/:id/node` | Set znode data |
| DELETE | `/api/zk/clusters/:id/node?path=PATH` | Delete znode |
| PUT | `/api/zk/clusters/:id/node/acl` | Set znode ACL |

---

## Default Credentials

On first run, a default admin account is created:

| Field | Value |
|-------|-------|
| Username | `admin` |
| Password | `admin` |

**Change the default password immediately after first login.**

---

---

# 中文文档

[English](#middleware-admin-platform) | **中文**

基于 Web 的中间件管理平台，支持 Kafka、Elasticsearch 和 ZooKeeper 集群的统一管理。后端使用 Go，前端使用 React + TypeScript。

> **All-in-One 单二进制部署** — 前端页面通过 `go:embed` 内嵌到 Go 二进制中，数据库使用内嵌 SQLite。**无需 Web 服务器、无需外部数据库、无需任何运行时依赖**，下载即用。

---

## 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [快速启动](#快速启动)
- [生产构建](#生产构建)
- [认证与权限](#认证与权限)
- [API 接口](#api-接口)
- [默认账号](#默认账号)

---

## 功能特性

### Kafka
- **集群管理** — 新增、编辑、删除集群。支持 PLAINTEXT、SASL/PLAIN、SCRAM-SHA-256、SCRAM-SHA-512 及其 SSL 变体，支持多节点配置和 TLS CA 证书。
- **Topic 管理** — 列表展示分区数、副本数、Leader 分区数和磁盘大小。支持创建、删除 Topic，查看每个分区的副本/ISR/偏移量详情。
- **分区操作** — 增加分区数、调整副本数（轮询分配到各 Broker）、查看/编辑原始分区分配方案、在 Broker 间迁移分区。
- **Topic 配置** — 查看并动态更新 Topic 配置（如 `retention.ms`、`segment.bytes`），支持重置单项配置为 Broker 默认值。
- **消费组** — 列出所有消费组及各 Topic 的 Lag 汇总。查看每个分区的 Lag 详情（消费偏移、日志结束偏移、成员 ID、Client ID、Client Host）。删除消费组，重置偏移量（最早/最新/时间戳/指定偏移）。
- **消息浏览** — 按偏移量或时间戳跨分区查询消息内容。
- **集群配置** — 查看和动态更新 Broker 配置，支持重置为默认值。
- **版本探测** — 通过 API Versions 请求自动推断 Kafka Broker 版本。

### Elasticsearch
- **集群管理** — 新增、编辑、删除集群。支持 HTTP/HTTPS、用户名/密码认证、TLS 跳过验证、多节点。
- **索引管理** — 列表展示健康状态、状态、主分片数、副本数、文档数和磁盘大小（按真实字节数排序）。支持 Open、Close、删除和批量删除/关闭。
- **Mapping 与 Settings** — 通过 JSON 编辑器查看和修改索引 Mapping 和 Settings。
- **节点列表** — 展示节点角色、CPU 使用率、堆内存使用率、磁盘可用/总量。
- **索引模板** — 列表、创建/更新、删除、批量删除。
- **ILM 策略** — 列表、创建/更新、删除、批量删除索引生命周期管理策略。
- **Dev Console** — 直接在浏览器中向 ES 集群发送原始 HTTP 请求（方法 + 路径 + JSON Body）。

### ZooKeeper
- **集群管理** — 新增、编辑、删除集群。支持 DIGEST-MD5 SASL 认证。
- **ZNode 浏览** — 树状导航 ZNode 层级结构，查看节点数据、Stat 元数据和 ACL。
- **ZNode 操作** — 创建、更新数据、删除 ZNode，设置 ACL 条目。
- **集群统计** — 查看集群统计信息（等效于 `mntr` 命令输出）。

### 用户与权限管理
- **JWT 认证** — 无状态 JWT 登录，除 `/auth/login` 外所有接口均需携带有效 Token。
- **角色控制** — `admin` 角色拥有全部权限（含用户管理），普通用户通过细粒度权限控制。
- **权限粒度** — 按操作维度授权，支持 Kafka/ES/ZK 集群的增删改及 Topic、消费组、ZNode 的各项操作。
- **Owner 权限** — 集群创建者对自己创建的集群自动拥有编辑和删除权限，无需管理员额外授权。
- **用户管理** — 仅管理员可操作：列出、创建、更新、删除用户。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端语言 | Go 1.22+ |
| HTTP 框架 | Gin |
| ORM | GORM |
| 数据库 | SQLite（内嵌，无需外部数据库）|
| Kafka 客户端 | IBM/sarama |
| ES 客户端 | elastic/go-elasticsearch |
| ZooKeeper 客户端 | go-zookeeper |
| 认证 | JWT (golang-jwt/jwt) |
| 前端框架 | React 18 + TypeScript |
| UI 组件库 | Ant Design 5 |
| 构建工具 | Vite |

---

## 项目结构

```
mw-admin/
├── backend/
│   ├── cmd/
│   │   ├── main.go          # 入口，路由注册
│   │   ├── static_dev.go    # 开发模式：代理到 Vite
│   │   └── static_prod.go   # 生产模式：内嵌前端静态文件
│   ├── internal/
│   │   ├── db/              # SQLite 初始化与自动迁移
│   │   ├── handlers/        # 各域 HTTP Handler
│   │   │   ├── auth.go
│   │   │   ├── es.go
│   │   │   ├── kafka.go
│   │   │   ├── users.go
│   │   │   └── zookeeper.go
│   │   ├── middleware/
│   │   │   └── auth.go      # JWT、权限、Owner 校验中间件
│   │   ├── models/
│   │   │   └── models.go    # GORM 数据模型
│   │   └── services/        # 业务逻辑
│   │       ├── auth.go
│   │       ├── es.go
│   │       ├── kafka.go
│   │       ├── scram.go     # SCRAM-SHA-256/512 客户端实现
│   │       ├── zk_sasl.go
│   │       └── zookeeper.go
│   └── go.mod
└── frontend/
    ├── src/
    │   ├── App.tsx           # 路由、侧边栏导航
    │   ├── components/       # ClusterSelector、ResizableColumns、弹窗组件
    │   ├── contexts/
    │   │   └── AuthContext.tsx
    │   ├── pages/
    │   │   ├── auth/         # 登录页
    │   │   ├── es/           # ES 相关页面
    │   │   ├── kafka/        # Kafka 相关页面
    │   │   ├── users/        # 用户管理页面
    │   │   └── zk/           # ZooKeeper 相关页面
    │   └── services/
    │       └── api.ts        # Axios API 封装
    ├── package.json
    └── vite.config.ts
```

---

## 快速启动

### 前置条件

- Go 1.22+
- Node.js 18+ 及 npm

### 启动后端

```bash
cd backend
go run ./cmd/main.go
# API 服务启动在 http://localhost:8080
```

### 启动前端（开发模式）

```bash
cd frontend
npm install
npm run dev
# 前端开发服务器启动在 http://localhost:3000
```

浏览器访问 `http://localhost:3000`。

---

## 生产构建

### Windows → Windows（`mw-admin.exe`）

```bat
build.bat
```

### Linux / macOS → 同平台（`mw-admin`）

```bash
chmod +x build.sh
./build.sh
```

### Windows → Linux 跨平台编译（`mw-admin`）

```bat
:: 编译 linux/amd64（默认）
build-linux.bat

:: 编译 linux/arm64
build-linux.bat arm64
```

> 使用 Go 原生交叉编译（`GOOS=linux GOARCH=amd64 CGO_ENABLED=0`），  
> 无需安装额外工具链或 WSL，仅需 Windows 上的 Go 和 Node.js 即可。

构建脚本执行流程：
1. 在 `frontend/` 目录执行 `npm run build`，输出到 `frontend/dist/`
2. 使用 `go:embed` 将前端静态文件内嵌到 Go 二进制中并编译后端
3. 输出单一可执行文件 `mw-admin`（Windows 为 `mw-admin.exe`）

直接运行二进制文件：

```bash
./mw-admin
# 同时提供 API 服务和前端页面，监听 http://localhost:8080
```

---

## 认证与权限

除 `POST /api/auth/login` 外，所有 API 接口均需在 `Authorization` 请求头中携带 JWT Bearer Token。

**角色说明：**
- `admin` — 拥有全部操作权限，包括用户管理
- 普通用户 — 通过以下细粒度权限控制访问

**权限项说明：**

| 权限标识 | 控制范围 |
|---|---|
| `kafka_cluster_add` | 创建 Kafka 集群 |
| `kafka_cluster_edit` | 编辑 Kafka 集群 |
| `kafka_cluster_delete` | 删除 Kafka 集群 |
| `kafka_topic_add` | 创建 Topic |
| `kafka_topic_edit` | 编辑分区、副本、配置、分配方案 |
| `kafka_topic_delete` | 删除 Topic |
| `kafka_consumer_group_delete` | 删除消费组、重置偏移量 |
| `es_cluster_add` | 创建 ES 集群 |
| `es_cluster_edit` | 编辑 ES 集群 |
| `es_cluster_delete` | 删除 ES 集群 |
| `zk_cluster_add` | 创建 ZooKeeper 集群 |
| `zk_cluster_edit` | 编辑 ZooKeeper 集群 |
| `zk_cluster_delete` | 删除 ZooKeeper 集群 |
| `zk_node_edit` | 创建/更新 ZNode 及 ACL |
| `zk_node_delete` | 删除 ZNode |

> 集群**创建者**（Owner）对自己创建的集群自动拥有编辑和删除权限，无需额外授权。

---

## API 接口

### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录，返回 JWT Token |
| GET | `/api/auth/me` | 获取当前用户信息 |

### 用户管理（仅管理员）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/users` | 用户列表 |
| POST | `/api/users` | 创建用户 |
| PUT | `/api/users/:id` | 更新用户（名称、密码、角色、权限） |
| DELETE | `/api/users/:id` | 删除用户 |

### Kafka — 集群

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/kafka/clusters` | 集群列表 |
| POST | `/api/kafka/clusters` | 创建集群 |
| GET | `/api/kafka/clusters/:id` | 集群详情 |
| PUT | `/api/kafka/clusters/:id` | 更新集群 |
| DELETE | `/api/kafka/clusters/:id` | 删除集群 |
| GET | `/api/kafka/clusters/:id/version` | 探测 Kafka 版本 |
| GET | `/api/kafka/clusters/:id/config` | Broker 配置列表 |
| PUT | `/api/kafka/clusters/:id/config` | 更新 Broker 配置项 |
| GET | `/api/kafka/clusters/:id/brokers` | Broker 列表 |

### Kafka — Topic

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/kafka/clusters/:id/topics` | Topic 列表（含分区、副本、磁盘） |
| GET | `/api/kafka/clusters/:id/topics/sizes` | 各 Topic 磁盘占用（字节） |
| POST | `/api/kafka/clusters/:id/topics` | 创建 Topic |
| GET | `/api/kafka/clusters/:id/topics/:topic` | Topic 详情（每分区副本/ISR/偏移/磁盘）|
| DELETE | `/api/kafka/clusters/:id/topics/:topic` | 删除 Topic |
| PUT | `/api/kafka/clusters/:id/topics/:topic/partitions` | 增加分区数 |
| PUT | `/api/kafka/clusters/:id/topics/:topic/replication` | 调整副本数 |
| GET | `/api/kafka/clusters/:id/topics/:topic/assignment` | 获取分区分配方案 |
| PUT | `/api/kafka/clusters/:id/topics/:topic/assignment` | 应用分区分配方案 |
| PUT | `/api/kafka/clusters/:id/topics/:topic/migrate` | 分区 Broker 迁移 |
| GET | `/api/kafka/clusters/:id/topics/:topic/config` | Topic 配置列表 |
| PUT | `/api/kafka/clusters/:id/topics/:topic/config` | 更新 Topic 配置项 |
| POST | `/api/kafka/clusters/:id/topics/:topic/fetch-messages` | 按偏移量或时间戳查询消息 |

### Kafka — 消费组

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/kafka/clusters/:id/consumer-groups` | 消费组列表（含 Lag 汇总） |
| GET | `/api/kafka/clusters/:id/consumer-groups/:group` | 消费组详情（分区 Lag、成员信息） |
| DELETE | `/api/kafka/clusters/:id/consumer-groups/:group` | 删除消费组 |
| POST | `/api/kafka/clusters/:id/consumer-groups/:group/reset-offsets` | 重置偏移量 |

### Elasticsearch — 集群

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/es/clusters` | 集群列表 |
| POST | `/api/es/clusters` | 创建集群 |
| GET | `/api/es/clusters/:id` | 集群详情 |
| PUT | `/api/es/clusters/:id` | 更新集群 |
| DELETE | `/api/es/clusters/:id` | 删除集群 |

### Elasticsearch — 索引

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/es/clusters/:id/indices` | 索引列表（健康、状态、分片、文档数、大小） |
| DELETE | `/api/es/clusters/:id/indices?index=NAME` | 删除单个索引 |
| POST | `/api/es/clusters/:id/indices/bulk-delete` | 批量删除索引 |
| POST | `/api/es/clusters/:id/indices/close?index=NAME` | 关闭索引 |
| POST | `/api/es/clusters/:id/indices/open?index=NAME` | 打开索引 |
| POST | `/api/es/clusters/:id/indices/bulk-close` | 批量关闭索引 |
| GET | `/api/es/clusters/:id/indices/mapping?index=NAME` | 获取索引 Mapping |
| PUT | `/api/es/clusters/:id/indices/mapping?index=NAME` | 更新索引 Mapping |
| GET | `/api/es/clusters/:id/indices/settings?index=NAME` | 获取索引 Settings |
| PUT | `/api/es/clusters/:id/indices/settings?index=NAME` | 更新索引 Settings |

### Elasticsearch — 其他

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/es/clusters/:id/nodes` | 节点列表（角色、CPU、堆内存、磁盘） |
| GET | `/api/es/clusters/:id/templates` | 索引模板列表 |
| PUT | `/api/es/clusters/:id/templates/:name` | 创建/更新索引模板 |
| DELETE | `/api/es/clusters/:id/templates?name=NAME` | 删除索引模板 |
| POST | `/api/es/clusters/:id/templates/bulk-delete` | 批量删除索引模板 |
| GET | `/api/es/clusters/:id/ilm` | ILM 策略列表 |
| PUT | `/api/es/clusters/:id/ilm/:name` | 创建/更新 ILM 策略 |
| DELETE | `/api/es/clusters/:id/ilm?name=NAME` | 删除 ILM 策略 |
| POST | `/api/es/clusters/:id/ilm/bulk-delete` | 批量删除 ILM 策略 |
| POST | `/api/es/clusters/:id/console` | Dev Console（代理任意 ES API 请求）|

### ZooKeeper — 集群

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/zk/clusters` | 集群列表 |
| POST | `/api/zk/clusters` | 创建集群 |
| GET | `/api/zk/clusters/:id` | 集群详情 |
| PUT | `/api/zk/clusters/:id` | 更新集群 |
| DELETE | `/api/zk/clusters/:id` | 删除集群 |
| GET | `/api/zk/clusters/:id/stats` | 集群统计信息 |

### ZooKeeper — ZNode

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/zk/clusters/:id/ls?path=PATH` | 列出子节点 |
| GET | `/api/zk/clusters/:id/node?path=PATH` | 获取节点数据、Stat 和 ACL |
| POST | `/api/zk/clusters/:id/node` | 创建节点 |
| PUT | `/api/zk/clusters/:id/node` | 更新节点数据 |
| DELETE | `/api/zk/clusters/:id/node?path=PATH` | 删除节点 |
| PUT | `/api/zk/clusters/:id/node/acl` | 设置节点 ACL |

---

## 默认账号

首次运行时自动创建默认管理员账号：

| 字段 | 值 |
|------|-----|
| 用户名 | `admin` |
| 密码 | `admin` |

**请在首次登录后立即修改默认密码。**
