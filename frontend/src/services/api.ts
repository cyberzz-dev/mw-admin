import axios from 'axios'

// In-memory CSRF token – set after login or session restore.
// Never stored in localStorage/sessionStorage to avoid XSS exposure.
let _csrfToken = ''
export function setCSRFToken(token: string) { _csrfToken = token }

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,   // send session cookie on every request
})

// Attach CSRF token to state-changing requests
api.interceptors.request.use(config => {
  const method = config.method?.toLowerCase()
  if (method && ['post', 'put', 'delete', 'patch'].includes(method)) {
    config.headers['X-CSRF-Token'] = _csrfToken
  }
  return config
})

// Redirect to /login on 401 (but not when already there)
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401 && window.location.pathname !== '/login') {
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// ---- Auth ----
export const loginApi = (username: string, password: string) =>
  api.post('/auth/login', { username, password })
export const logoutApi = () => api.post('/auth/logout')
export const getMe = () => api.get('/auth/me')

// ---- Users ----
export const listUsers = () => api.get('/users')
export const createUser = (data: any) => api.post('/users', data)
export const updateUser = (id: number, data: any) => api.put(`/users/${id}`, data)
export const deleteUser = (id: number) => api.delete(`/users/${id}`)

// ---- Kafka Cluster ----
export const listKafkaClusters = () => api.get('/kafka/clusters')
export const getKafkaCluster = (id: number) => api.get(`/kafka/clusters/${id}`)
export const createKafkaCluster = (data: any) => api.post('/kafka/clusters', data)
export const updateKafkaCluster = (id: number, data: any) => api.put(`/kafka/clusters/${id}`, data)
export const deleteKafkaCluster = (id: number) => api.delete(`/kafka/clusters/${id}`)
export const getKafkaClusterVersion = (id: number) => api.get(`/kafka/clusters/${id}/version`)

// ---- Kafka Topics ----
export const listTopics = (clusterId: number) => api.get(`/kafka/clusters/${clusterId}/topics`)
export const getTopicDiskSizes = (clusterId: number) => api.get(`/kafka/clusters/${clusterId}/topics/sizes`)
export const createTopic = (clusterId: number, data: any) => api.post(`/kafka/clusters/${clusterId}/topics`, data)
export const deleteTopic = (clusterId: number, topic: string) => api.delete(`/kafka/clusters/${clusterId}/topics/${topic}`)
export const getTopicDetail = (clusterId: number, topic: string) => api.get(`/kafka/clusters/${clusterId}/topics/${topic}`)
export const updateTopicPartitions = (clusterId: number, topic: string, partitions: number) =>
  api.put(`/kafka/clusters/${clusterId}/topics/${topic}/partitions`, { partitions })
export const updateTopicReplication = (clusterId: number, topic: string, replicas: number) =>
  api.put(`/kafka/clusters/${clusterId}/topics/${topic}/replication`, { replicas })
export const listKafkaBrokers = (clusterId: number) => api.get(`/kafka/clusters/${clusterId}/brokers`)
export const listBrokerPartitions = (clusterId: number, brokerId: number) =>
  api.get(`/kafka/clusters/${clusterId}/brokers/${brokerId}/partitions`)
export const getTopicAssignment = (clusterId: number, topic: string) =>
  api.get(`/kafka/clusters/${clusterId}/topics/${topic}/assignment`)
export const applyTopicAssignment = (clusterId: number, topic: string, data: any) =>
  api.put(`/kafka/clusters/${clusterId}/topics/${topic}/assignment`, data)
export const migrateTopicPartitions = (clusterId: number, topic: string, data: {
  src_broker: number
  dst_broker: number
  throttle_bytes_per_sec: number
  partitions?: number[]
}) => api.put(`/kafka/clusters/${clusterId}/topics/${topic}/migrate`, data)
export const listKafkaReassignmentTasks = (clusterId: number, topic?: string) =>
  api.get(`/kafka/clusters/${clusterId}/reassignment-tasks`, { params: topic ? { topic } : undefined })
export const verifyKafkaReassignmentTask = (clusterId: number, taskId: number) =>
  api.post(`/kafka/clusters/${clusterId}/reassignment-tasks/${taskId}/verify`)
export const cancelKafkaReassignmentTask = (clusterId: number, taskId: number) =>
  api.post(`/kafka/clusters/${clusterId}/reassignment-tasks/${taskId}/cancel`)
export const fetchTopicMessages = (clusterId: number, topic: string, params: {
  mode: 'time' | 'offset'
  timestamp_ms?: number
  partition?: number
  start_offset?: number
  count?: number
}) => api.post(`/kafka/clusters/${clusterId}/topics/${topic}/fetch-messages`, params)

// ---- Kafka Consumer Groups ----
export const listConsumerGroups = (clusterId: number) => api.get(`/kafka/clusters/${clusterId}/consumer-groups`)
export const getConsumerGroupDetail = (clusterId: number, group: string) =>
  api.get(`/kafka/clusters/${clusterId}/consumer-groups/${group}`)
export const deleteConsumerGroup = (clusterId: number, group: string) =>
  api.delete(`/kafka/clusters/${clusterId}/consumer-groups/${group}`)
export const resetConsumerGroupOffsets = (
  clusterId: number,
  group: string,
  topic: string,
  resetType: 'earliest' | 'latest' | 'timestamp' | 'offset',
  options?: {
    timestampMs?: number
    partitions?: number[]
    partitionOffsets?: Record<string, number>
  }
) =>
  api.post(`/kafka/clusters/${clusterId}/consumer-groups/${group}/reset-offsets`, {
    topic,
    reset_type: resetType,
    timestamp_ms: options?.timestampMs,
    partitions: options?.partitions,
    partition_offsets: options?.partitionOffsets,
  })

// ---- Kafka Cluster Config ----
export const getClusterConfig = (clusterId: number, brokerId: number) =>
  api.get(`/kafka/clusters/${clusterId}/config`, { params: { broker_id: brokerId } })
export const getAllBrokersConfig = (clusterId: number) =>
  api.get(`/kafka/clusters/${clusterId}/config/compare`)
export const updateClusterConfig = (clusterId: number, name: string, value: string | null, brokerId = -1) =>
  api.put(`/kafka/clusters/${clusterId}/config`, { name, value, broker_id: brokerId })

// ---- Kafka Topic Config ----
export const getTopicConfig = (clusterId: number, topic: string) =>
  api.get(`/kafka/clusters/${clusterId}/topics/${topic}/config`)
export const updateTopicConfig = (clusterId: number, topic: string, name: string, value: string | null) =>
  api.put(`/kafka/clusters/${clusterId}/topics/${topic}/config`, { name, value })

// ---- ES Cluster ----
export const listESClusters = () => api.get('/es/clusters')
export const getESCluster = (id: number) => api.get(`/es/clusters/${id}`)
export const createESCluster = (data: any) => api.post('/es/clusters', data)
export const updateESCluster = (id: number, data: any) => api.put(`/es/clusters/${id}`, data)
export const deleteESCluster = (id: number) => api.delete(`/es/clusters/${id}`)

// ---- ES Operations ----
export const listESIndices = (clusterId: number) => api.get(`/es/clusters/${clusterId}/indices`)
export const listESNodes = (clusterId: number) => api.get(`/es/clusters/${clusterId}/nodes`)
export const listESTemplates = (clusterId: number) => api.get(`/es/clusters/${clusterId}/templates`)
export const listESILMPolicies = (clusterId: number) => api.get(`/es/clusters/${clusterId}/ilm`)

// ES Index operations
export const deleteESIndex = (clusterId: number, indexName: string) =>
  api.delete(`/es/clusters/${clusterId}/indices`, { params: { index: indexName } })
export const bulkDeleteESIndices = (clusterId: number, indices: string[]) =>
  api.post(`/es/clusters/${clusterId}/indices/bulk-delete`, { indices })
export const closeESIndex = (clusterId: number, indexName: string) =>
  api.post(`/es/clusters/${clusterId}/indices/close`, null, { params: { index: indexName } })
export const openESIndex = (clusterId: number, indexName: string) =>
  api.post(`/es/clusters/${clusterId}/indices/open`, null, { params: { index: indexName } })
export const bulkCloseESIndices = (clusterId: number, indices: string[]) =>
  api.post(`/es/clusters/${clusterId}/indices/bulk-close`, { indices })
export const getESIndexMapping = (clusterId: number, indexName: string) =>
  api.get(`/es/clusters/${clusterId}/indices/mapping`, { params: { index: indexName } })
export const getESIndexSettings = (clusterId: number, indexName: string) =>
  api.get(`/es/clusters/${clusterId}/indices/settings`, { params: { index: indexName } })
export const putESIndexMapping = (clusterId: number, indexName: string, body: any) =>
  api.put(`/es/clusters/${clusterId}/indices/mapping`, body, { params: { index: indexName } })
export const putESIndexSettings = (clusterId: number, indexName: string, body: any) =>
  api.put(`/es/clusters/${clusterId}/indices/settings`, body, { params: { index: indexName } })

// ES Template operations
export const deleteESTemplate = (clusterId: number, name: string) =>
  api.delete(`/es/clusters/${clusterId}/templates`, { params: { name } })
export const bulkDeleteESTemplates = (clusterId: number, names: string[]) =>
  api.post(`/es/clusters/${clusterId}/templates/bulk-delete`, { names })
export const putESTemplate = (clusterId: number, name: string, body: any) =>
  api.put(`/es/clusters/${clusterId}/templates/${name}`, body)

// ES Component Template operations
export const listESComponentTemplates = (clusterId: number) => api.get(`/es/clusters/${clusterId}/component-templates`)
export const deleteESComponentTemplate = (clusterId: number, name: string) =>
  api.delete(`/es/clusters/${clusterId}/component-templates`, { params: { name } })
export const bulkDeleteESComponentTemplates = (clusterId: number, names: string[]) =>
  api.post(`/es/clusters/${clusterId}/component-templates/bulk-delete`, { names })
export const putESComponentTemplate = (clusterId: number, name: string, body: any) =>
  api.put(`/es/clusters/${clusterId}/component-templates/${name}`, body)

// ES ILM operations
export const deleteESILMPolicy = (clusterId: number, name: string) =>
  api.delete(`/es/clusters/${clusterId}/ilm`, { params: { name } })
export const bulkDeleteESILMPolicies = (clusterId: number, names: string[]) =>
  api.post(`/es/clusters/${clusterId}/ilm/bulk-delete`, { names })
export const putESILMPolicy = (clusterId: number, name: string, body: any) =>
  api.put(`/es/clusters/${clusterId}/ilm/${name}`, body)

export const esDevConsole = (clusterId: number, method: string, path: string, body?: string) =>
  api.post(`/es/clusters/${clusterId}/console`, { method, path, body: body || '' })

// ---- ZK Cluster ----
export const listZKClusters = () => api.get('/zk/clusters')
export const createZKCluster = (data: any) => api.post('/zk/clusters', data)
export const getZKCluster = (id: number) => api.get(`/zk/clusters/${id}`)
export const updateZKCluster = (id: number, data: any) => api.put(`/zk/clusters/${id}`, data)
export const deleteZKCluster = (id: number) => api.delete(`/zk/clusters/${id}`)

// ---- ZK Operations ----
export const listZKChildren = (clusterId: number, path: string, offset = 0, limit = 200) =>
  api.get(`/zk/clusters/${clusterId}/ls`, { params: { path, offset, limit } })
export const getZKNode = (clusterId: number, path: string) =>
  api.get(`/zk/clusters/${clusterId}/node`, { params: { path } })
export const createZKNode = (clusterId: number, data: { path: string; data: string; flags: number; acls: any[] }) =>
  api.post(`/zk/clusters/${clusterId}/node`, data)
export const setZKNodeData = (clusterId: number, path: string, data: string, version: number) =>
  api.put(`/zk/clusters/${clusterId}/node`, { path, data, version })
export const deleteZKNode = (clusterId: number, path: string, version = -1, recursive = false) =>
  api.delete(`/zk/clusters/${clusterId}/node`, { params: { path, version, ...(recursive ? { recursive: true } : {}) } })
export const setZKACL = (clusterId: number, path: string, acls: any[], version: number) =>
  api.put(`/zk/clusters/${clusterId}/node/acl`, { path, acls, version })
export const getZKStats = (clusterId: number) =>
  api.get(`/zk/clusters/${clusterId}/stats`)

