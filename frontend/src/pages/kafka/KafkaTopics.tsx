import React, { useState, useEffect, useRef, useLayoutEffect } from 'react'
import {
  Table, Button, message, Modal, Form, Input, InputNumber,
  Space, Tag, Spin, Dropdown, Select, Radio, Checkbox, Drawer,
  DatePicker, Typography, Tooltip
} from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined, ReloadOutlined, DownOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useSearchParams } from 'react-router-dom'
import KafkaTopicConfig from './KafkaTopicConfig'
import ClusterSelector from '../../components/ClusterSelector'
import { useResizableColumns, tableComponents } from '../../components/ResizableColumns'
import { useAuth } from '../../contexts/AuthContext'
import {
  listKafkaClusters, listTopics, getTopicDiskSizes, createTopic, deleteTopic,
  updateTopicPartitions, getTopicAssignment, applyTopicAssignment,
  listKafkaBrokers, getTopicDetail, fetchTopicMessages,
  migrateTopicPartitions, listKafkaReassignmentTasks, verifyKafkaReassignmentTask, cancelKafkaReassignmentTask
} from '../../services/api'

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '-'
  if (bytes >= 1099511627776) return `${(bytes / 1099511627776).toFixed(2)} TB`
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${bytes} B`
}

export default function KafkaTopics({ fixedClusterId }: { fixedClusterId?: number } = {}) {
  const [searchParams] = useSearchParams()
  const [clusterId, setClusterId] = useState<number | undefined>(fixedClusterId)
  const [topics, setTopics] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [partitionOpen, setPartitionOpen] = useState(false)
  const [replicaOpen, setReplicaOpen] = useState(false)
  const [selectedTopic, setSelectedTopic] = useState<any>(null)
  const [detailCache, setDetailCache] = useState<{ [name: string]: any }>({})
  const [expandingKeys, setExpandingKeys] = useState<Set<string>>(new Set())
  const [refreshingKeys, setRefreshingKeys] = useState<Set<string>>(new Set())
  const [activeDetailTopic, setActiveDetailTopic] = useState<string | null>(null)
  const [assignJson, setAssignJson] = useState('')
  const [assignLoading, setAssignLoading] = useState(false)
  const [assignThrottleBytesPerSec, setAssignThrottleBytesPerSec] = useState<number>(10 * 1024 * 1024)
  const [migrateOpen, setMigrateOpen] = useState(false)
  const [brokers, setBrokers] = useState<any[]>([])
  const [brokersLoading, setBrokersLoading] = useState(false)
  const [migrateAssignment, setMigrateAssignment] = useState<Record<string, number[]>>({})
  const [migrateLoadingAssign, setMigrateLoadingAssign] = useState(false)
  const [migrateScope, setMigrateScope] = useState<'all' | 'custom'>('all')
  const [migrateSelectedPartitions, setMigrateSelectedPartitions] = useState<string[]>([])
  const [migrateSrcBroker, setMigrateSrcBroker] = useState<number | undefined>()
  const [migrateTasks, setMigrateTasks] = useState<any[]>([])
  const [migrateTasksLoading, setMigrateTasksLoading] = useState(false)
  const [migrateTaskActionId, setMigrateTaskActionId] = useState<number | undefined>()
  const [selectedRowKey, setSelectedRowKey] = useState<string | undefined>()
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([])
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{ label: string; onOk: () => void } | null>(null)
  const [deleteInput, setDeleteInput] = useState('')
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  const [batchDeleteInput, setBatchDeleteInput] = useState('')
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false)
  const [configTopic, setConfigTopic] = useState<any>(null)
  const [search, setSearch] = useState('')
  const [diskSizes, setDiskSizes] = useState<Record<string, number>>({})
  const [sizesLoading, setSizesLoading] = useState(false)
  const [fetchOpen, setFetchOpen] = useState(false)
  const [fetchTopic, setFetchTopic] = useState<any>(null)
  const [fetchMode, setFetchMode] = useState<'time' | 'offset'>('time')
  const [fetchLoading, setFetchLoading] = useState(false)
  const [fetchMessages, setFetchMessages] = useState<any[]>([])
  const [fetchTimestamp, setFetchTimestamp] = useState<dayjs.Dayjs | null>(null)
  const [fetchCount, setFetchCount] = useState<number>(20)
  const [fetchPartition, setFetchPartition] = useState<number>(0)
  const [fetchOffset, setFetchOffset] = useState<number>(0)
  const [form] = Form.useForm()
  const [partitionForm] = Form.useForm()
  const [migrateForm] = Form.useForm()
  const { hasPermission, isOwnScopeUser } = useAuth()

  // Init cluster and search from URL params on mount (e.g. navigated from Consumer Groups)
  useEffect(() => {
    if (fixedClusterId) return
    const c = searchParams.get('cluster')
    const t = searchParams.get('topic')
    if (c) setClusterId(Number(c))
    if (t) setSearch(t)
  }, [])

  const fetchTopics = async () => {
    if (!clusterId) return
    setLoading(true)
    try {
      const res = await listTopics(clusterId)
      setTopics(res.data || [])
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to fetch topics')
    }
    setLoading(false)
  }

  const fetchDiskSizes = async (cid: number) => {
    setSizesLoading(true)
    try {
      const res = await getTopicDiskSizes(cid)
      setDiskSizes(res.data || {})
    } catch {
      // non-critical, silently ignore
    }
    setSizesLoading(false)
  }

  useEffect(() => {
    if (clusterId) {
      fetchTopics().then(() => fetchDiskSizes(clusterId))
    }
  }, [clusterId])

  // Clear cache when cluster changes (user action)
  useEffect(() => {
    setDetailCache({})
    setExpandingKeys(new Set())
    setActiveDetailTopic(null)
  }, [clusterId])

  const loadDetail = async (topicName: string) => {
    if (detailCache[topicName] || expandingKeys.has(topicName)) return
    setExpandingKeys(prev => new Set(prev).add(topicName))
    try {
      const res = await getTopicDetail(clusterId!, topicName)
      setDetailCache(prev => ({ ...prev, [topicName]: res.data }))
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to fetch details')
    }
    setExpandingKeys(prev => { const s = new Set(prev); s.delete(topicName); return s })
  }

  const forceLoadDetail = async (topicName: string) => {
    if (expandingKeys.has(topicName) || refreshingKeys.has(topicName)) return
    setRefreshingKeys(prev => new Set(prev).add(topicName))
    try {
      const res = await getTopicDetail(clusterId!, topicName)
      setDetailCache(prev => ({ ...prev, [topicName]: res.data }))
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to fetch details')
    }
    setRefreshingKeys(prev => { const s = new Set(prev); s.delete(topicName); return s })
  }

  const handleCreate = async (values: any) => {
    try {
      await createTopic(clusterId!, values)
      message.success('Created successfully')
      setCreateOpen(false)
      form.resetFields()
      fetchTopics()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to create')
    }
  }

  const handleDelete = async (name: string) => {
    try {
      await deleteTopic(clusterId!, name)
      message.success('Deleted successfully')
      fetchTopics()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to delete')
    }
  }

  const handleBatchDelete = async () => {
    setBatchDeleting(true)
    let failed = 0
    for (const name of selectedRowKeys) {
      try {
        await deleteTopic(clusterId!, name)
      } catch {
        failed++
      }
    }
    setBatchDeleting(false)
    setSelectedRowKeys([])
    if (failed === 0) message.success(`Deleted ${selectedRowKeys.length} topic(s) successfully`)
    else message.warning(`${selectedRowKeys.length - failed} deleted, ${failed} failed`)
    fetchTopics()
  }

  const openDeleteConfirm = (label: string, onOk: () => void) => {
    setDeleteInput('')
    setDeleteConfirm({ label, onOk })
  }

  const handleAdjustPartitions = async (values: any) => {
    try {
      await updateTopicPartitions(clusterId!, selectedTopic.name, values.partitions)
      message.success('Partitions adjusted successfully')
      setPartitionOpen(false)
      fetchTopics()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Adjustment failed')
    }
  }

  const openReplicaModal = async (record: any) => {
    setSelectedTopic(record)
    setReplicaOpen(true)
    setAssignLoading(true)
    setAssignJson('')
    setBrokers([])
    setAssignThrottleBytesPerSec(10 * 1024 * 1024)
    setMigrateTasks([])
    setMigrateTasksLoading(true)
    try {
      const [assignRes, brokersRes, tasksRes] = await Promise.all([
        getTopicAssignment(clusterId!, record.name),
        listKafkaBrokers(clusterId!),
        listKafkaReassignmentTasks(clusterId!, record.name),
      ])
      setAssignJson(JSON.stringify(assignRes.data, null, 2))
      setBrokers(brokersRes.data || [])
      setMigrateTasks(tasksRes.data || [])
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to fetch replica assignment')
      setReplicaOpen(false)
    } finally {
      setAssignLoading(false)
      setMigrateTasksLoading(false)
    }
  }

  const handleApplyAssignment = async () => {
    let parsed: any
    try {
      parsed = JSON.parse(assignJson)
    } catch (e: any) {
      message.error('JSON parse error: ' + e.message)
      return
    }
    if (!assignThrottleBytesPerSec || assignThrottleBytesPerSec <= 0) {
      message.warning('Please set migration throttle')
      return
    }
    try {
      await applyTopicAssignment(clusterId!, selectedTopic.name, {
        assignment: parsed,
        throttle_bytes_per_sec: assignThrottleBytesPerSec,
      })
      message.success('Replica adjustment task submitted. Use Verify or Cancel from the task list.')
      await refreshMigrateTasks()
      fetchTopics()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Replica adjustment failed')
      await refreshMigrateTasks()
    }
  }

  const handleIncreaseReplicas = () => {
    try {
      const parsed: Record<string, number[]> = JSON.parse(assignJson)
      const allIds: number[] = brokers.map((b: any) => b.id)
      if (allIds.length === 0) {
        message.warning('Broker list not loaded, please close and reopen')
        return
      }
      const usage: Record<number, number> = {}
      allIds.forEach(id => { usage[id] = 0 })
      Object.values(parsed).forEach(replicas => replicas.forEach(id => { if (id in usage) usage[id]++ }))
      const newParsed = { ...parsed }
      for (const p of Object.keys(newParsed)) {
        const current = newParsed[p]
        const available = allIds.filter(id => !current.includes(id))
        if (available.length === 0) {
          message.warning(`Partition ${p} already covers all brokers, cannot add more`)
          return
        }
        available.sort((a, b) => usage[a] - usage[b])
        const picked = available[0]
        newParsed[p] = [...current, picked]
        usage[picked]++
      }
      setAssignJson(JSON.stringify(newParsed, null, 2))
    } catch {
      message.error('JSON format error, please fix before proceeding')
    }
  }

  const handleDecreaseReplicas = () => {
    try {
      const parsed: Record<string, number[]> = JSON.parse(assignJson)
      const newParsed = { ...parsed }
      for (const p of Object.keys(newParsed)) {
        if (newParsed[p].length <= 1) {
          message.warning(`Partition ${p} already has 1 replica, cannot reduce further`)
          return
        }
        newParsed[p] = newParsed[p].slice(0, -1)
      }
      setAssignJson(JSON.stringify(newParsed, null, 2))
    } catch {
      message.error('JSON format error, please fix before proceeding')
    }
  }

  const openMigrateModal = async (record: any) => {
    setSelectedTopic(record)
    migrateForm.resetFields()
    migrateForm.setFieldsValue({ throttle_bytes_per_sec: 10 * 1024 * 1024 })
    setMigrateScope('all')
    setMigrateSelectedPartitions([])
    setMigrateSrcBroker(undefined)
    setMigrateAssignment({})
    setMigrateTasks([])
    setBrokersLoading(true)
    setMigrateLoadingAssign(true)
    setMigrateTasksLoading(true)
    setMigrateOpen(true)
    try {
      const [brokersRes, assignRes, tasksRes] = await Promise.all([
        listKafkaBrokers(clusterId!),
        getTopicAssignment(clusterId!, record.name),
        listKafkaReassignmentTasks(clusterId!, record.name),
      ])
      setBrokers(brokersRes.data || [])
      setMigrateAssignment(assignRes.data || {})
      setMigrateTasks(tasksRes.data || [])
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to initialize migration')
      setMigrateOpen(false)
    } finally {
      setBrokersLoading(false)
      setMigrateLoadingAssign(false)
      setMigrateTasksLoading(false)
    }
  }

  const refreshMigrateTasks = async () => {
    if (!clusterId || !selectedTopic) return
    setMigrateTasksLoading(true)
    try {
      const res = await listKafkaReassignmentTasks(clusterId, selectedTopic.name)
      setMigrateTasks(res.data || [])
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to fetch migration tasks')
    } finally {
      setMigrateTasksLoading(false)
    }
  }

  const handleMigratePartitions = async (values: any) => {
    const { src_broker, dst_broker, throttle_bytes_per_sec } = values
    if (src_broker === dst_broker) {
      message.warning('Source and destination brokers must be different')
      return
    }
    let partitions: string[]
    if (migrateScope === 'custom') {
      if (migrateSelectedPartitions.length === 0) {
        message.warning('Please select partitions to migrate')
        return
      }
      partitions = migrateSelectedPartitions
    } else {
      partitions = Object.keys(migrateAssignment).filter(p =>
        migrateAssignment[p]?.includes(src_broker)
      )
      if (partitions.length === 0) {
        message.warning(`Broker ${src_broker} does not appear in any partition replica`)
        return
      }
    }
    try {
      await migrateTopicPartitions(clusterId!, selectedTopic.name, {
        src_broker,
        dst_broker,
        throttle_bytes_per_sec,
        partitions: migrateScope === 'custom' ? partitions.map(p => Number(p)) : undefined,
      })
      message.success('Partition migration task submitted. Use Verify or Cancel from the task list.')
      await refreshMigrateTasks()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Partition migration failed')
      await refreshMigrateTasks()
    }
  }

  const handleVerifyMigrationTask = async (taskId: number) => {
    setMigrateTaskActionId(taskId)
    try {
      const res = await verifyKafkaReassignmentTask(clusterId!, taskId)
      message.success(res.data?.message || 'Task verified')
      await refreshMigrateTasks()
      if (selectedTopic?.name) forceLoadDetail(selectedTopic.name)
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Verify failed')
    } finally {
      setMigrateTaskActionId(undefined)
    }
  }

  const handleCancelMigrationTask = async (taskId: number) => {
    setMigrateTaskActionId(taskId)
    try {
      const res = await cancelKafkaReassignmentTask(clusterId!, taskId)
      message.success(res.data?.message || 'Task cancelled')
      await refreshMigrateTasks()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Cancel failed')
    } finally {
      setMigrateTaskActionId(undefined)
    }
  }

  const handleFetchMessages = async () => {
    if (!clusterId || !fetchTopic) return
    if (fetchMode === 'time' && !fetchTimestamp) { message.warning('Please select a start time'); return }
    setFetchLoading(true)
    try {
      const params: any = { mode: fetchMode, count: fetchCount || 20 }
      if (fetchMode === 'time') {
        params.timestamp_ms = fetchTimestamp!.valueOf()
      } else {
        params.partition = fetchPartition
        params.start_offset = fetchOffset
      }
      const res = await fetchTopicMessages(clusterId, fetchTopic.name, params)
      setFetchMessages(res.data || [])
      if ((res.data || []).length === 0) message.info('No messages found in the specified range')
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Fetch failed')
    } finally {
      setFetchLoading(false)
    }
  }

  const baseColumns = [
    {
      title: 'Topic Name', dataIndex: 'name', width: 280, ellipsis: true, defaultSortOrder: 'ascend' as const, sorter: (a: any, b: any) => (a.name || '').localeCompare(b.name || ''),
      onCell: () => ({
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
        onDoubleClick: (e: React.MouseEvent) => {
          e.stopPropagation()
          const cell = (e.currentTarget as HTMLElement)
          const text = cell.innerText || cell.textContent || ''
          navigator.clipboard.writeText(text.trim()).then(() => message.success('Copied!', 1))
        },
      }),
    },
    { title: 'Partitions', dataIndex: 'partitions', width: 90, sorter: (a: any, b: any) => a.partitions - b.partitions },
    { title: 'Replicas', dataIndex: 'replicas', width: 90, sorter: (a: any, b: any) => a.replicas - b.replicas },
    {
      title: 'Log Size', dataIndex: 'disk_size_bytes', width: 100,
      sorter: (a: any, b: any) => (diskSizes[a.name] || 0) - (diskSizes[b.name] || 0),
      render: (_: any, record: any) => {
        if (sizesLoading) return <Spin size="small" />
        const v = diskSizes[record.name] || 0
        return formatBytes(v)
      },
    },
    {
      title: 'Actions', width: 160,
      render: (_: any, record: any) => {
        const items: any[] = [
          {
            key: 'fetch',
            label: 'Fetch Messages',
            icon: <SearchOutlined />,
            onClick: () => {
              setFetchTopic(record); setFetchMode('time'); setFetchMessages([])
              setFetchTimestamp(null); setFetchCount(20); setFetchPartition(0); setFetchOffset(0)
              setFetchOpen(true)
            },
          },
          { type: 'divider' },
          {
            key: 'config',
            label: 'Configuration',
            onClick: () => { setConfigTopic(record); setConfigDrawerOpen(true) },
          },
          ...(hasPermission('kafka_topic_edit') || isOwnScopeUser ? [
            { type: 'divider' },
            {
              key: 'partitions',
              label: 'Adjust Partitions',
              onClick: () => {
                setSelectedTopic(record)
                partitionForm.setFieldsValue({ partitions: record.partitions })
                setPartitionOpen(true)
              },
            },
            {
              key: 'replica',
              label: 'Adjust Replicas',
              onClick: () => openReplicaModal(record),
            },
            {
              key: 'migrate',
              label: 'Migrate Partitions',
              onClick: () => openMigrateModal(record),
            },
          ] : []),
        ]
        return (
          <Space onClick={e => e.stopPropagation()}>
            <Dropdown menu={{ items }} trigger={['click']}>
              <Button size="small" icon={<EditOutlined />}>Actions <DownOutlined /></Button>
            </Dropdown>
            {(hasPermission('kafka_topic_delete') || isOwnScopeUser) && (
              <Button size="small" danger icon={<DeleteOutlined />} onClick={() => openDeleteConfirm(record.name, () => handleDelete(record.name))}>Delete</Button>
            )}
          </Space>
        )
      },
    },
  ]
  const columns = useResizableColumns(baseColumns)

  const partitionColumns = [
    { title: 'Partition ID', dataIndex: 'partition_id', width: 80, sorter: (a: any, b: any) => a.partition_id - b.partition_id, defaultSortOrder: 'ascend' as const },
    { title: 'Start Offset', dataIndex: 'earliest_offset', width: 120, render: (v: number) => v >= 0 ? v : '-' },
    { title: 'Latest Offset', dataIndex: 'latest_offset', width: 120, render: (v: number) => v >= 0 ? v : '-' },
    {
      title: 'Msg Count (est.)', width: 110,
      render: (_: any, r: any) => {
        const n = (r.latest_offset ?? 0) - (r.earliest_offset ?? 0)
        return n >= 0 ? n : '-'
      },
    },
    {
      title: 'Log Size', dataIndex: 'disk_size_bytes', width: 100,
      sorter: (a: any, b: any) => (a.disk_size_bytes || 0) - (b.disk_size_bytes || 0),
      render: (v: number) => formatBytes(v),
    },
    {
      title: 'Preferred', dataIndex: 'preferred_leader', width: 90,
      filters: [{ text: 'Yes', value: true }, { text: 'No', value: false }],
      onFilter: (value: any, r: any) => r.preferred_leader === value,
      render: (v: boolean) => v
        ? <Tag color="success">Yes</Tag>
        : <Tag color="error">No</Tag>,
    },
    { title: 'Leader', dataIndex: 'leader', width: 80 },
    {
      title: 'Replicas (Distribution)', dataIndex: 'replicas', width: 180,
      render: (v: number[]) => (v || []).map(r => <Tag key={r}>{r}</Tag>),
    },
    {
      title: 'ISR', dataIndex: 'isr', width: 150,
      render: (v: number[]) => (v || []).map(r => <Tag key={r} color="green">{r}</Tag>),
    },
  ]

  const migrationStatusColor = (status: string) => {
    if (status === 'completed') return 'success'
    if (status === 'running' || status === 'submitted') return 'processing'
    if (status === 'cancelled') return 'default'
    if (status === 'failed') return 'error'
    return 'default'
  }

  const migrationOperationLabel = (operation: string) => {
    if (operation === 'replica_adjustment') return 'Replica Adjustment'
    return 'Partition Migration'
  }

  const normalizeTaskMessage = (messageText?: string) => {
    if (!messageText) return '-'
    const mappings: Array<[string, string]> = [
      ['迁移任务已创建，正在提交 Kafka reassignment', 'Partition migration task created; submitting Kafka reassignment'],
      ['副本调整任务已创建，正在提交 Kafka reassignment', 'Replica adjustment task created; submitting Kafka reassignment'],
      ['迁移已提交，等待 verify 确认完成', 'Partition migration submitted; waiting for verification'],
      ['副本调整已提交，等待 verify 确认完成', 'Replica adjustment submitted; waiting for verification'],
      ['迁移完成，限速配置已清理', 'Reassignment completed; throttle configs cleared'],
      ['迁移已取消，限速配置已清理', 'Reassignment cancelled; throttle configs cleared'],
      ['Kafka 已无迁移任务，但当前副本分配未达到目标状态', 'Kafka has no active reassignment, but current replicas do not match the target assignment'],
      ['设置迁移限速失败', 'Failed to set migration throttle'],
      ['设置副本调整限速失败', 'Failed to set replica adjustment throttle'],
      ['提交 Kafka reassignment 失败', 'Failed to submit Kafka reassignment'],
      ['取消迁移失败', 'Failed to cancel reassignment'],
      ['迁移完成，但清理限速配置失败', 'Reassignment completed, but failed to clear throttle configs'],
      ['迁移已取消，但清理限速配置失败', 'Reassignment cancelled, but failed to clear throttle configs'],
      ['清理限速配置失败', 'failed to clear throttle configs'],
    ]
    let normalized = messageText
    mappings.forEach(([from, to]) => {
      normalized = normalized.replace(from, to)
    })
    normalized = normalized.replace(/(\d+) 个分区仍在迁移中/g, '$1 partition(s) still reassigning')
    return normalized
  }

  const migrationTaskColumns = [
    { title: 'ID', dataIndex: 'id', width: 48 },
    {
      title: 'Operation', dataIndex: 'operation', width: 118,
      render: (v: string) => migrationOperationLabel(v),
    },
    {
      title: 'Brokers', width: 76,
      render: (_: any, record: any) => record.operation === 'replica_adjustment'
        ? '-'
        : `${record.source_broker} → ${record.target_broker}`,
    },
    {
      title: 'Partitions', dataIndex: 'partitions', width: 110,
      render: (v: number[]) => (v || []).length > 6 ? `${v.slice(0, 6).join(', ')} ... (${v.length})` : (v || []).join(', '),
    },
    {
      title: 'Throttle', dataIndex: 'throttle_bytes_per_sec', width: 86,
      render: (v: number) => `${formatBytes(v)}/s`,
    },
    {
      title: 'Status', dataIndex: 'status', width: 88,
      render: (v: string) => <Tag color={migrationStatusColor(v)}>{v}</Tag>,
    },
    {
      title: 'Message', dataIndex: 'message', width: 150, ellipsis: true,
      render: (v: string) => <Tooltip title={normalizeTaskMessage(v)}>{normalizeTaskMessage(v)}</Tooltip>,
    },
    {
      title: 'Actions', width: 120,
      render: (_: any, record: any) => {
        const done = ['completed', 'cancelled'].includes(record.status)
        return (
          <Space size={4}>
            <Button
              size="small"
              onClick={() => handleVerifyMigrationTask(record.id)}
              loading={migrateTaskActionId === record.id}
              disabled={record.status === 'cancelled'}
            >
              Verify
            </Button>
            <Button
              size="small"
              danger
              disabled={done}
              loading={migrateTaskActionId === record.id}
              onClick={() => Modal.confirm({
                title: `Cancel migration task #${record.id}?`,
                content: 'Kafka will stop the ongoing partition reassignment for the recorded partitions and keep the task history.',
                okText: 'Cancel Task',
                okButtonProps: { danger: true },
                onOk: () => handleCancelMigrationTask(record.id),
              })}
            >
              Cancel
            </Button>
          </Space>
        )
      },
    },
  ]

  const totalPartitions = topics.reduce((sum, t) => sum + (t.partitions || 0) * (t.replicas || 1), 0)
  const totalLeaderPartitions = topics.reduce((sum, t) => sum + (t.leader_partitions || 0), 0)
  const filteredTopics = search
    ? topics.filter(t => (t.name || '').toLowerCase().includes(search.toLowerCase()))
    : topics

  const [detailPanelHeight, setDetailPanelHeight] = useState(300)
  const dragStartY = useRef<number>(0)
  const dragStartHeight = useRef<number>(0)
  const handleDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    dragStartY.current = e.clientY
    dragStartHeight.current = detailPanelHeight
    const onMove = (ev: MouseEvent) => {
      const delta = dragStartY.current - ev.clientY
      setDetailPanelHeight(Math.max(170, Math.min(tableScrollY - 128, dragStartHeight.current + delta)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const tableRef = useRef<HTMLDivElement>(null)
  const [tableScrollY, setTableScrollY] = useState(500)
  useLayoutEffect(() => {
    const compute = () => {
      if (!tableRef.current) return
      const top = tableRef.current.getBoundingClientRect().top
      setTableScrollY(Math.max(200, window.innerHeight - top - 96))
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [topics.length, clusterId])
  const clampedDetailHeight = activeDetailTopic
    ? Math.max(170, Math.min(detailPanelHeight, tableScrollY - 128))
    : 0
  const topScrollY = activeDetailTopic ? Math.max(120, tableScrollY - clampedDetailHeight - 8) : tableScrollY

  return (
    <div>
      <div className="page-header" style={{ justifyContent: 'flex-start', gap: 16 }}>
        {!fixedClusterId && (
          <>
            <h2 style={{ margin: 0, whiteSpace: 'nowrap' }}>Topics</h2>
            <ClusterSelector
              value={clusterId}
              onChange={(id) => { setSearch(''); setClusterId(id) }}
              fetchClusters={listKafkaClusters}
              placeholder="Select Kafka cluster"
            />
          </>
        )}
        <Space style={{ flex: 1, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
          {(hasPermission('kafka_topic_delete') || isOwnScopeUser) && selectedRowKeys.length > 0 && (
            <Button danger icon={<DeleteOutlined />} loading={batchDeleting} onClick={() => { setBatchDeleteInput(''); setBatchDeleteOpen(true) }}>
              Delete Selected ({selectedRowKeys.length})
            </Button>
          )}
          {hasPermission('kafka_topic_add') && clusterId && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              Create Topic
            </Button>
          )}
          <Input.Search
            placeholder="Filter topics…"
            allowClear
            value={search}
            onChange={e => setSearch(e.target.value)}
            disabled={!clusterId}
            style={{ width: 220 }}
          />
          <Button icon={<ReloadOutlined />} disabled={!clusterId} onClick={() => { fetchTopics(); if (clusterId) fetchDiskSizes(clusterId) }} loading={loading || sizesLoading}>Refresh</Button>
        </Space>
      </div>

      {clusterId && topics.length > 0 && (
        <div style={{
          display: 'flex', gap: 12, marginBottom: 16,
        }}>
          {[
            { label: 'Topics', value: topics.length },
            { label: 'Partitions', value: totalPartitions },
            { label: 'Leader Partitions', value: totalLeaderPartitions },
          ].map(({ label, value }) => (
            <div key={label} style={{
              background: '#f8f9fa',
              border: '1px solid #e1e4e5',
              borderRadius: 6,
              padding: '10px 20px',
              minWidth: 120,
              textAlign: 'center' as const,
            }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#0f1111', lineHeight: 1.2 }}>{value}</div>
              <div style={{ fontSize: 12, color: '#545b64', marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      <div ref={tableRef} style={activeDetailTopic ? { minHeight: topScrollY + 96 } : {}}>
      <Table
        rowKey="name"
        components={tableComponents}
        columns={columns}
        dataSource={filteredTopics}
        locale={{ emptyText: (
          <div style={{ padding: '40px 0', color: '#87909a', fontSize: 14, textAlign: 'center' }}>
            {!clusterId ? 'Select a cluster to view topics' : 'No data'}
          </div>
        ) }}
        loading={loading}
        size="small"
        rowSelection={(hasPermission('kafka_topic_delete') || isOwnScopeUser) ? {
          selectedRowKeys,
          onChange: (keys) => {
            const newKeys = keys as string[]
            setSelectedRowKeys(newKeys)
            // When exactly one checkbox selected, show its detail panel
            if (newKeys.length === 1) {
              const name = newKeys[0]
              setActiveDetailTopic(name)
              loadDetail(name)
            }
          },
        } : undefined}
        rowClassName={(record) => record.name === activeDetailTopic ? 'row-selected' : ''}
        onRow={(record) => ({
          onMouseEnter: () => setSelectedRowKey(record.name),
          onClick: () => {
            if (activeDetailTopic === record.name) {
              setActiveDetailTopic(null)
            } else {
              setActiveDetailTopic(record.name)
              loadDetail(record.name)
            }
          },
          style: { cursor: 'pointer' },
        })}
        tableLayout="fixed"
        scroll={{ y: topScrollY }}
        pagination={{ defaultPageSize: 20, pageSizeOptions: ['20', '50', '100', '200'], showSizeChanger: true, showTotal: (total) => `${total} topics`, size: 'small' }}
      />
      </div>

      {activeDetailTopic && (
        <>
          <div
            onMouseDown={handleDividerMouseDown}
            style={{
              height: 8,
              background: '#e1e4e5',
              cursor: 'row-resize',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              userSelect: 'none',
              flexShrink: 0,
            }}
          >
            <div style={{ width: 40, height: 3, background: '#adb5bd', borderRadius: 2 }} />
          </div>
          <div style={{ height: clampedDetailHeight, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', background: '#f8f9fa', borderBottom: '1px solid #e1e4e5', flexShrink: 0 }}>
              <Typography.Text strong>Partitions — {activeDetailTopic}</Typography.Text>
              <Space>
                <Button size="small" icon={<ReloadOutlined />} loading={refreshingKeys.has(activeDetailTopic)} onClick={() => forceLoadDetail(activeDetailTopic)}>Refresh</Button>
                <Button size="small" onClick={() => setActiveDetailTopic(null)}>✕</Button>
              </Space>
            </div>
            {expandingKeys.has(activeDetailTopic) ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spin tip="Loading..." /></div>
            ) : (
              <Table
                rowKey="partition_id"
                columns={partitionColumns}
                dataSource={detailCache[activeDetailTopic]?.partitions || []}
                loading={refreshingKeys.has(activeDetailTopic)}
                pagination={{ defaultPageSize: 10, pageSizeOptions: ['10', '20', '50'], showSizeChanger: true, showTotal: (total) => `${total} partitions`, size: 'small' }}
                size="small"
                tableLayout="fixed"
                scroll={{ x: 1100, y: Math.max(40, clampedDetailHeight - 126) }}
              />
            )}
          </div>
        </>
      )}

      {/* Create Topic Modal */}
      <Modal title="Create Topic" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => form.submit()} destroyOnClose>
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="name" label="Topic Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="partitions" label="Partitions" rules={[{ required: true }]} initialValue={3}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="replicas" label="Replicas" rules={[{ required: true }]} initialValue={1}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Adjust Partitions Modal */}
      <Modal
        title={`Adjust Partitions — ${selectedTopic?.name}`}
        open={partitionOpen}
        onCancel={() => setPartitionOpen(false)}
        onOk={() => partitionForm.submit()}
        destroyOnClose
      >
        <Form form={partitionForm} layout="vertical" onFinish={handleAdjustPartitions}>
          <Form.Item name="partitions" label="New Partition Count (can only increase)" rules={[{ required: true }]}>
            <InputNumber min={selectedTopic?.partitions + 1 || 2} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Adjust Replica Assignment Modal */}
      <Modal
        title={`Adjust Replicas — ${selectedTopic?.name}`}
        open={replicaOpen}
        onCancel={() => setReplicaOpen(false)}
        onOk={handleApplyAssignment}
        okText="Submit"
        width={860}
        destroyOnClose
      >
        {assignLoading ? (
          <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ color: '#666', fontSize: 13 }}>
                Current replicas:{' '}
                {(() => { try { const v = Object.values(JSON.parse(assignJson)) as number[][]; return v[0]?.length ?? '-' } catch { return '-' } })()}
              </span>
              <Button size="small" onClick={handleDecreaseReplicas}>− Decrease Replicas</Button>
              <Button size="small" onClick={handleIncreaseReplicas} disabled={brokers.length === 0}>+ Increase Replicas</Button>
            </div>
            <div style={{ marginBottom: 12 }}>
              <Typography.Text style={{ display: 'block', marginBottom: 4 }}>Migration Throttle</Typography.Text>
              <InputNumber
                min={1}
                value={assignThrottleBytesPerSec}
                onChange={value => setAssignThrottleBytesPerSec(Number(value || 0))}
                addonAfter="bytes/sec"
                style={{ width: '100%' }}
                formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                parser={value => Number((value || '').replace(/,/g, '')) as any}
              />
            </div>
            <Input.TextArea
              value={assignJson}
              onChange={e => setAssignJson(e.target.value)}
              rows={11}
              style={{ fontFamily: 'monospace', fontSize: 13 }}
            />
            <div style={{ marginTop: 8, color: '#888', fontSize: 12 }}>
              Format: {'{"'}partition ID{'": ['}replica broker IDs{', ...]}'}. First broker ID is the preferred leader. Kafka migrates data asynchronously after submission; the task is retained for verify or cancel.
            </div>
            <div style={{ marginTop: 16, borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Typography.Text strong>Reassignment Tasks</Typography.Text>
                <Button size="small" icon={<ReloadOutlined />} onClick={refreshMigrateTasks} loading={migrateTasksLoading}>Refresh</Button>
              </div>
              <Table
                rowKey="id"
                columns={migrationTaskColumns}
                dataSource={migrateTasks}
                loading={migrateTasksLoading}
                size="small"
                pagination={{ pageSize: 5, size: 'small' }}
                tableLayout="fixed"
                locale={{ emptyText: 'No reassignment tasks yet' }}
              />
            </div>
          </>
        )}
      </Modal>

      {/* Migrate Partitions Modal */}
      <Modal
        title={`Migrate Partitions — ${selectedTopic?.name}`}
        open={migrateOpen}
        onCancel={() => { setMigrateOpen(false); migrateForm.resetFields(); setMigrateScope('all'); setMigrateSelectedPartitions([]) }}
        onOk={() => migrateForm.submit()}
        okText="Submit Migration"
        width={860}
        destroyOnClose
      >
        <Spin spinning={brokersLoading || migrateLoadingAssign}>
          <Form
            form={migrateForm}
            layout="vertical"
            onFinish={handleMigratePartitions}
            onValuesChange={(changed) => {
              if ('src_broker' in changed) {
                setMigrateSrcBroker(changed.src_broker)
                setMigrateSelectedPartitions([])
              }
            }}
          >
            <Form.Item name="src_broker" label="Source Broker (to be replaced)" rules={[{ required: true, message: 'Please select source broker' }]}>
              <Select
                options={brokers.map((b: any) => ({ value: b.id, label: `Broker ${b.id}  (${b.addr})` }))}
                placeholder="Select source broker"
              />
            </Form.Item>
            <Form.Item name="dst_broker" label="Target Broker" rules={[{ required: true, message: 'Please select target broker' }]}>
              <Select
                options={brokers.map((b: any) => ({ value: b.id, label: `Broker ${b.id}  (${b.addr})` }))}
                placeholder="Select target broker"
              />
            </Form.Item>
            <Form.Item
              name="throttle_bytes_per_sec"
              label="Migration Throttle"
              rules={[{ required: true, message: 'Please set migration throttle' }]}
              tooltip="Bytes per second per broker for leader/follower replication throttles"
            >
              <InputNumber
                min={1}
                addonAfter="bytes/sec"
                style={{ width: '100%' }}
                formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                parser={value => Number((value || '').replace(/,/g, '')) as any}
              />
            </Form.Item>
            <Form.Item label="Scope">
              <Radio.Group
                value={migrateScope}
                onChange={e => { setMigrateScope(e.target.value); setMigrateSelectedPartitions([]) }}
              >
                <Radio value="all">All partitions</Radio>
                <Radio value="custom">Select partitions</Radio>
              </Radio.Group>
            </Form.Item>
            {migrateScope === 'custom' && (
              <Form.Item label="Select Partitions">
                {migrateSrcBroker === undefined ? (
                  <span style={{ color: '#aaa', fontSize: 12 }}>Select the source broker first to filter eligible partitions</span>
                ) : (() => {
                  const eligible = Object.keys(migrateAssignment)
                    .filter(p => migrateAssignment[p]?.includes(migrateSrcBroker))
                    .sort((a, b) => Number(a) - Number(b))
                  return eligible.length === 0 ? (
                    <span style={{ color: '#f5222d', fontSize: 12 }}>Source broker does not appear in any partition replica</span>
                  ) : (
                    <Checkbox.Group
                      value={migrateSelectedPartitions}
                      onChange={vals => setMigrateSelectedPartitions(vals as string[])}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
                        {eligible.map(p => (
                          <Checkbox key={p} value={p}>
                            Partition {p}: replicas [{migrateAssignment[p]?.join(', ')}]
                          </Checkbox>
                        ))}
                      </div>
                    </Checkbox.Group>
                  )
                })()}
              </Form.Item>
            )}
          </Form>
          <div style={{ color: '#888', fontSize: 12 }}>
            Replaces the source broker in the selected partition replica lists with the target broker. The task is retained for later verify or cancel, and verify clears the temporary throttle after completion.
          </div>
          <div style={{ marginTop: 16, borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Typography.Text strong>Reassignment Tasks</Typography.Text>
              <Button size="small" icon={<ReloadOutlined />} onClick={refreshMigrateTasks} loading={migrateTasksLoading}>Refresh</Button>
            </div>
            <Table
              rowKey="id"
              columns={migrationTaskColumns}
              dataSource={migrateTasks}
              loading={migrateTasksLoading}
              size="small"
              pagination={{ pageSize: 5, size: 'small' }}
              tableLayout="fixed"
              locale={{ emptyText: 'No migration tasks yet' }}
            />
          </div>
        </Spin>
      </Modal>

      <Modal
        title="Confirm deletion"
        open={!!deleteConfirm}
        okText="Delete"
        okButtonProps={{ danger: true, disabled: deleteInput !== deleteConfirm?.label }}
        onOk={() => { deleteConfirm?.onOk(); setDeleteConfirm(null) }}
        onCancel={() => setDeleteConfirm(null)}
        destroyOnClose
      >
        <p>Type <strong>{deleteConfirm?.label}</strong> to confirm deletion:</p>
        <Input
          value={deleteInput}
          onChange={e => setDeleteInput(e.target.value)}
          onPressEnter={() => { if (deleteInput === deleteConfirm?.label) { deleteConfirm?.onOk(); setDeleteConfirm(null) } }}
          autoFocus
        />
      </Modal>

      <Modal
        title={`Delete ${selectedRowKeys.length} topic(s)`}
        open={batchDeleteOpen}
        okText="Delete"
        okButtonProps={{ danger: true, disabled: batchDeleteInput !== 'delete' }}
        onOk={() => { setBatchDeleteOpen(false); handleBatchDelete() }}
        onCancel={() => setBatchDeleteOpen(false)}
        destroyOnClose
      >
        <p>You are about to permanently delete <strong>{selectedRowKeys.length}</strong> topic(s). This action cannot be undone.</p>
        <p>Type <strong>delete</strong> to confirm:</p>
        <Input
          value={batchDeleteInput}
          onChange={e => setBatchDeleteInput(e.target.value)}
          onPressEnter={() => { if (batchDeleteInput === 'delete') { setBatchDeleteOpen(false); handleBatchDelete() } }}
          autoFocus
          placeholder="delete"
        />
      </Modal>

      <Drawer
        title={`Configuration — ${configTopic?.name}`}
        open={configDrawerOpen}
        onClose={() => setConfigDrawerOpen(false)}
        width={860}
        destroyOnClose
      >
        <KafkaTopicConfig
          embedded
          fixedClusterId={clusterId}
          fixedTopicName={configTopic?.name}
        />
      </Drawer>

      <Drawer
        title={`Fetch Messages — ${fetchTopic?.name}`}
        open={fetchOpen}
        onClose={() => setFetchOpen(false)}
        width={960}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Radio.Group value={fetchMode} onChange={e => { setFetchMode(e.target.value); setFetchMessages([]) }} buttonStyle="solid">
            <Radio.Button value="time">By Time</Radio.Button>
            <Radio.Button value="offset">By Partition &amp; Offset</Radio.Button>
          </Radio.Group>
          <Space wrap align="end">
            {fetchMode === 'time' ? (
              <>
                <div>
                  <div style={{ marginBottom: 4, fontSize: 12, color: '#888' }}>Start Time (local)</div>
                  <DatePicker showTime value={fetchTimestamp} onChange={v => setFetchTimestamp(v)} placeholder="Select start time" style={{ width: 220 }} />
                </div>
                <div>
                  <div style={{ marginBottom: 4, fontSize: 12, color: '#888' }}>Max Count (≤ 1000)</div>
                  <InputNumber min={1} max={1000} value={fetchCount} onChange={v => setFetchCount(v || 20)} style={{ width: 120 }} />
                </div>
              </>
            ) : (
              <>
                <div>
                  <div style={{ marginBottom: 4, fontSize: 12, color: '#888' }}>Partition</div>
                  <InputNumber min={0} value={fetchPartition} onChange={v => setFetchPartition(v ?? 0)} style={{ width: 120 }} />
                </div>
                <div>
                  <div style={{ marginBottom: 4, fontSize: 12, color: '#888' }}>Start Offset</div>
                  <InputNumber min={0} value={fetchOffset} onChange={v => setFetchOffset(v ?? 0)} style={{ width: 160 }} />
                </div>
                <div>
                  <div style={{ marginBottom: 4, fontSize: 12, color: '#888' }}>Max Count (≤ 1000)</div>
                  <InputNumber min={1} max={1000} value={fetchCount} onChange={v => setFetchCount(v || 20)} style={{ width: 120 }} />
                </div>
              </>
            )}
            <Button type="primary" icon={<SearchOutlined />} loading={fetchLoading} onClick={handleFetchMessages}>Fetch</Button>
          </Space>
          {!fetchLoading && fetchMessages.length > 0 && (
            <>
              <Typography.Text type="secondary">{fetchMessages.length} message(s) fetched</Typography.Text>
              <Table
                rowKey={(r: any) => `${r.partition}-${r.offset}`}
                size="small"
                columns={[
                  { title: 'Partition', dataIndex: 'partition', width: 90, sorter: (a: any, b: any) => a.partition - b.partition },
                  { title: 'Offset', dataIndex: 'offset', width: 100, sorter: (a: any, b: any) => a.offset - b.offset },
                  { title: 'Timestamp', dataIndex: 'timestamp', width: 190, sorter: (a: any, b: any) => (a.timestamp || '').localeCompare(b.timestamp || '') },
                  { title: 'Size', dataIndex: 'size', width: 100, sorter: (a: any, b: any) => (a.size || 0) - (b.size || 0), render: (v: number) => formatBytes(v) },
                  {
                    title: 'Key', dataIndex: 'key', width: 160,
                    render: (v: string) => v
                      ? <Tooltip title={v}><Typography.Text ellipsis style={{ maxWidth: 140 }}>{v}</Typography.Text></Tooltip>
                      : <Typography.Text type="secondary">—</Typography.Text>,
                  },
                  {
                    title: 'Value', dataIndex: 'value',
                    render: (v: string) => v
                      ? <Tooltip title={<pre style={{ maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', margin: 0, fontSize: 12 }}>{v.length > 2000 ? v.slice(0, 2000) + '…' : v}</pre>} placement="left" overlayStyle={{ maxWidth: 520 }}>
                          <Typography.Text ellipsis style={{ maxWidth: 500 }}>{v}</Typography.Text>
                        </Tooltip>
                      : <Typography.Text type="secondary">—</Typography.Text>,
                  },
                ]}
                dataSource={fetchMessages}
                pagination={{ pageSize: 20, pageSizeOptions: ['20', '50', '100'], showSizeChanger: true, showTotal: t => `${t} total` }}
                scroll={{ x: 1200 }}
              />
            </>
          )}
        </Space>
      </Drawer>
    </div>
  )
}
