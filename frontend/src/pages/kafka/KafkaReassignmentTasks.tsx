import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, Input, Modal, Space, Table, Tag, Tooltip, message } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import ClusterSelector from '../../components/ClusterSelector'
import { tableComponents, useResizableColumns } from '../../components/ResizableColumns'
import { useAuth } from '../../contexts/AuthContext'
import {
  cancelKafkaReassignmentTask,
  getTopicAssignment,
  listKafkaClusters,
  listKafkaReassignmentTasks,
  verifyKafkaReassignmentTask,
} from '../../services/api'

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '-'
  if (bytes >= 1099511627776) return `${(bytes / 1099511627776).toFixed(2)} TB`
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${bytes} B`
}

function statusColor(status: string) {
  if (status === 'completed') return 'success'
  if (status === 'running' || status === 'submitted' || status === 'preparing') return 'processing'
  if (status === 'cancelled') return 'default'
  if (status === 'failed') return 'error'
  return 'default'
}

function operationLabel(operation: string) {
  if (operation === 'replica_adjustment') return 'Replica Adjustment'
  return 'Partition Migration'
}

function normalizeTaskMessage(messageText?: string) {
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
  return normalized.replace(/(\d+) 个分区仍在迁移中/g, '$1 partition(s) still reassigning')
}

function formatReplicas(replicas: number[] | undefined) {
  if (!replicas || replicas.length === 0) return '-'
  return `[${replicas.join(', ')}]`
}

function sameReplicas(expected: number[] | undefined, actual: number[] | undefined, operation: string) {
  const expectedReplicas = expected || []
  const actualReplicas = actual || []
  if (expectedReplicas.length !== actualReplicas.length) return false
  if (operation === 'replica_adjustment') {
    return [...expectedReplicas].sort((a, b) => a - b).every((value, index) => value === [...actualReplicas].sort((a, b) => a - b)[index])
  }
  return expectedReplicas.every((value, index) => value === actualReplicas[index])
}

function describeReplicaDiff(expected: number[] | undefined, actual: number[] | undefined) {
  const expectedReplicas = expected || []
  const actualReplicas = actual || []
  const changes: Array<{ text: string; color: string }> = []
  const maxLength = Math.max(expectedReplicas.length, actualReplicas.length)

  for (let index = 0; index < maxLength; index++) {
    const expectedValue = expectedReplicas[index]
    const actualValue = actualReplicas[index]
    if (expectedValue === actualValue) continue
    if (expectedValue === undefined && actualValue !== undefined) {
      changes.push({ text: `+${actualValue}`, color: 'success' })
    } else if (expectedValue !== undefined && actualValue === undefined) {
      changes.push({ text: `-${expectedValue}`, color: 'error' })
    } else {
      changes.push({ text: `${expectedValue} -> ${actualValue}`, color: 'warning' })
    }
  }

  return changes
}

type AssignmentDiffRow = {
  partition: string
  original: number[] | undefined
  expected: number[] | undefined
  actual: number[] | undefined
  matched: boolean
  changes: Array<{ text: string; color: string }>
}

function buildAssignmentDiffRows(record: any): AssignmentDiffRow[] {
  const target = record.target_assignment || {}
  const finalAssignment = record.final_assignment || {}
  const original = record.original_assignment || {}
  const partitions = (record.partitions || []).length > 0
    ? record.partitions.map((partition: number) => String(partition))
    : Array.from(new Set([...Object.keys(target), ...Object.keys(finalAssignment)])).sort((a: any, b: any) => Number(a) - Number(b))

  return partitions.map((partition: string) => {
    const expected = target[partition]
    const actual = finalAssignment[partition]
    const matched = sameReplicas(expected, actual, record.operation)
    const changes = describeReplicaDiff(original[partition], expected)
    return {
      partition,
      original: original[partition],
      expected,
      actual,
      matched,
      changes,
    }
  })
}

function renderAssignmentDiff(record: any, finalAssignmentOverride?: Record<string, number[]>, loadingFinalAssignment = false) {
  const effectiveRecord = {
    ...record,
    final_assignment: record.final_assignment && Object.keys(record.final_assignment).length > 0
      ? record.final_assignment
      : finalAssignmentOverride,
  }
  const rows = buildAssignmentDiffRows(effectiveRecord)
  const hasFinalAssignment = effectiveRecord.final_assignment && Object.keys(effectiveRecord.final_assignment).length > 0
  const mismatchCount = hasFinalAssignment ? rows.filter(row => !row.matched).length : 0

  const diffColumns = [
    { title: 'Partition', dataIndex: 'partition', width: 90, sorter: (a: any, b: any) => Number(a.partition) - Number(b.partition) },
    { title: 'Original', dataIndex: 'original', render: (v: number[]) => formatReplicas(v) },
    { title: 'Expected', dataIndex: 'expected', render: (v: number[]) => formatReplicas(v) },
    { title: 'Final', dataIndex: 'actual', render: (v: number[]) => hasFinalAssignment ? formatReplicas(v) : '-' },
    {
      title: 'Change', dataIndex: 'changes', width: 180,
      render: (changes: AssignmentDiffRow['changes'], row: AssignmentDiffRow) => {
        return changes.length > 0
          ? <span>{changes.map(change => <Tag key={change.text} color={change.color}>{change.text}</Tag>)}</span>
          : <Tag color="success">No change</Tag>
      },
    },
    {
      title: 'Result', dataIndex: 'matched', width: 130,
      render: (matched: boolean) => {
        if (!hasFinalAssignment) return <Tag color="default">{loadingFinalAssignment ? 'Loading final...' : 'Pending final'}</Tag>
        return matched ? <Tag color="success">Matched</Tag> : <Tag color="error">Different</Tag>
      },
    },
  ]

  return (
    <div style={{ padding: '8px 12px', minWidth: 0, overflowX: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontWeight: 600 }}>Expected vs Final Assignment</span>
        {hasFinalAssignment ? (
          <Tag color={mismatchCount === 0 ? 'success' : 'error'}>
            {mismatchCount === 0 ? 'No differences' : `${mismatchCount} partition(s) different`}
          </Tag>
        ) : (
          <Tag color="default">{loadingFinalAssignment ? 'Loading current final assignment' : 'Final assignment not captured yet'}</Tag>
        )}
      </div>
      <Table
        rowKey="partition"
        columns={diffColumns}
        dataSource={rows}
        size="small"
        pagination={false}
        tableLayout="fixed"
        scroll={{ y: 260 }}
      />
    </div>
  )
}

export default function KafkaReassignmentTasks({ fixedClusterId }: { fixedClusterId?: number } = {}) {
  const [clusterId, setClusterId] = useState<number | undefined>(fixedClusterId)
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [actionTaskId, setActionTaskId] = useState<number | undefined>()
  const [finalAssignmentOverrides, setFinalAssignmentOverrides] = useState<Record<number, Record<string, number[]>>>({})
  const [loadingFinalTaskIds, setLoadingFinalTaskIds] = useState<Set<number>>(new Set())
  const tableRef = useRef<HTMLDivElement>(null)
  const [tableScrollY, setTableScrollY] = useState(500)
  const { hasPermission, isOwnScopeUser } = useAuth()
  const canManageTasks = hasPermission('kafka_topic_edit') || isOwnScopeUser

  const fetchTasks = async () => {
    if (!clusterId) return
    setLoading(true)
    try {
      const res = await listKafkaReassignmentTasks(clusterId)
      setTasks(res.data || [])
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to fetch reassignment tasks')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchTasks() }, [clusterId])

  useEffect(() => {
    setTasks([])
    setSearch('')
    setFinalAssignmentOverrides({})
    setLoadingFinalTaskIds(new Set())
  }, [clusterId])

  const loadFinalAssignmentIfNeeded = async (record: any) => {
    if (!clusterId || !record?.topic) return
    if (record.final_assignment && Object.keys(record.final_assignment).length > 0) return
    if (finalAssignmentOverrides[record.id] || loadingFinalTaskIds.has(record.id)) return
    setLoadingFinalTaskIds(prev => new Set(prev).add(record.id))
    try {
      const res = await getTopicAssignment(clusterId, record.topic)
      setFinalAssignmentOverrides(prev => ({ ...prev, [record.id]: res.data || {} }))
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to fetch final assignment')
    } finally {
      setLoadingFinalTaskIds(prev => {
        const next = new Set(prev)
        next.delete(record.id)
        return next
      })
    }
  }

  useLayoutEffect(() => {
    const compute = () => {
      if (!tableRef.current) return
      const top = tableRef.current.getBoundingClientRect().top
      setTableScrollY(Math.max(240, window.innerHeight - top - 96))
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [tasks.length, clusterId])

  const handleVerifyTask = async (taskId: number) => {
    if (!clusterId) return
    setActionTaskId(taskId)
    try {
      const res = await verifyKafkaReassignmentTask(clusterId, taskId)
      message.success(res.data?.message || 'Task verified')
      await fetchTasks()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Verify failed')
    } finally {
      setActionTaskId(undefined)
    }
  }

  const handleCancelTask = async (taskId: number) => {
    if (!clusterId) return
    setActionTaskId(taskId)
    try {
      const res = await cancelKafkaReassignmentTask(clusterId, taskId)
      message.success(res.data?.message || 'Task cancelled')
      await fetchTasks()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Cancel failed')
    } finally {
      setActionTaskId(undefined)
    }
  }

  const filteredTasks = search
    ? tasks.filter(task => {
        const q = search.toLowerCase()
        return String(task.id).includes(q)
          || (task.topic || '').toLowerCase().includes(q)
          || (task.operation || '').toLowerCase().includes(q)
          || (task.status || '').toLowerCase().includes(q)
          || (task.message || '').toLowerCase().includes(q)
      })
    : tasks

  const baseColumns = [
    { title: 'ID', dataIndex: 'id', width: 70, sorter: (a: any, b: any) => a.id - b.id, defaultSortOrder: 'descend' as const },
    {
      title: 'Topic', dataIndex: 'topic', width: 240, ellipsis: true,
      sorter: (a: any, b: any) => (a.topic || '').localeCompare(b.topic || ''),
    },
    {
      title: 'Operation', dataIndex: 'operation', width: 150,
      filters: [
        { text: 'Partition Migration', value: 'partition_migration' },
        { text: 'Replica Adjustment', value: 'replica_adjustment' },
      ],
      onFilter: (value: any, record: any) => record.operation === value,
      render: (v: string) => operationLabel(v),
    },
    {
      title: 'Brokers', width: 110,
      render: (_: any, record: any) => record.operation === 'replica_adjustment'
        ? '-'
        : `${record.source_broker} -> ${record.target_broker}`,
    },
    {
      title: 'Partitions', dataIndex: 'partitions', width: 150,
      render: (v: number[]) => {
        const partitions = v || []
        if (partitions.length === 0) return '-'
        const text = partitions.join(', ')
        const label = partitions.length > 8 ? `${partitions.slice(0, 8).join(', ')} ... (${partitions.length})` : text
        return <Tooltip title={text}>{label}</Tooltip>
      },
    },
    {
      title: 'Throttle', dataIndex: 'throttle_bytes_per_sec', width: 120,
      sorter: (a: any, b: any) => (a.throttle_bytes_per_sec || 0) - (b.throttle_bytes_per_sec || 0),
      render: (v: number) => `${formatBytes(v)}/s`,
    },
    {
      title: 'Status', dataIndex: 'status', width: 110,
      filters: ['preparing', 'submitted', 'running', 'completed', 'cancelled', 'failed'].map(status => ({ text: status, value: status })),
      onFilter: (value: any, record: any) => record.status === value,
      render: (v: string) => <Tag color={statusColor(v)}>{v}</Tag>,
    },
    {
      title: 'Message', dataIndex: 'message', width: 260, ellipsis: true,
      render: (v: string) => <Tooltip title={normalizeTaskMessage(v)}>{normalizeTaskMessage(v)}</Tooltip>,
    },
    {
      title: 'Updated', dataIndex: 'updated_at', width: 170,
      sorter: (a: any, b: any) => dayjs(a.updated_at).valueOf() - dayjs(b.updated_at).valueOf(),
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-',
    },
    ...(canManageTasks ? [{
      title: 'Actions', width: 140,
      render: (_: any, record: any) => {
        const done = ['completed', 'cancelled'].includes(record.status)
        return (
          <Space size={4}>
            <Button
              size="small"
              onClick={() => handleVerifyTask(record.id)}
              loading={actionTaskId === record.id}
              disabled={done}
            >
              Verify
            </Button>
            <Button
              size="small"
              danger
              disabled={done}
              loading={actionTaskId === record.id}
              onClick={() => Modal.confirm({
                title: `Cancel reassignment task #${record.id}?`,
                content: 'Kafka will stop the ongoing partition reassignment for the recorded partitions and keep the task history.',
                okText: 'Cancel Task',
                okButtonProps: { danger: true },
                onOk: () => handleCancelTask(record.id),
              })}
            >
              Cancel
            </Button>
          </Space>
        )
      },
    }] : []),
  ]
  const columns = useResizableColumns(baseColumns)

  return (
    <div>
      <div className="page-header" style={{ justifyContent: 'flex-start', gap: 16 }}>
        {!fixedClusterId && (
          <>
            <h2 style={{ margin: 0, whiteSpace: 'nowrap' }}>Reassignment Tasks</h2>
            <ClusterSelector
              value={clusterId}
              onChange={setClusterId}
              fetchClusters={listKafkaClusters}
              placeholder="Select Kafka cluster"
            />
          </>
        )}
        <Space style={{ flex: 1, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
          <Input.Search
            placeholder="Filter tasks..."
            allowClear
            value={search}
            onChange={e => setSearch(e.target.value)}
            disabled={!clusterId}
            style={{ width: 240 }}
          />
          <Button icon={<ReloadOutlined />} onClick={fetchTasks} disabled={!clusterId} loading={loading}>Refresh</Button>
        </Space>
      </div>

      <div ref={tableRef} style={{ minWidth: 0, overflowX: 'hidden' }}>
        <Table
          rowKey="id"
          components={tableComponents}
          columns={columns}
          dataSource={filteredTasks}
          loading={loading}
          size="small"
          tableLayout="fixed"
          scroll={{ y: tableScrollY }}
          expandable={{
            expandedRowRender: (record: any) => renderAssignmentDiff(
              record,
              finalAssignmentOverrides[record.id],
              loadingFinalTaskIds.has(record.id)
            ),
            onExpand: (expanded, record: any) => {
              if (expanded) loadFinalAssignmentIfNeeded(record)
            },
          }}
          locale={{ emptyText: clusterId ? 'No reassignment tasks' : 'Please select a cluster' }}
          pagination={{
            defaultPageSize: 20,
            pageSizeOptions: ['20', '50', '100', '200'],
            showSizeChanger: true,
            showTotal: n => `${n} tasks`,
            size: 'small',
          }}
        />
      </div>
    </div>
  )
}