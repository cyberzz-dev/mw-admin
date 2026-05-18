import React, { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { Table, message, Space, Button, Tag, Spin, Typography, Modal, Input, Radio, Alert, Checkbox, InputNumber, Divider, Tooltip } from 'antd'
import { DatePicker } from 'antd'
import { ReloadOutlined, DeleteOutlined, RetweetOutlined, DownloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'
import ClusterSelector from '../../components/ClusterSelector'
import { useResizableColumns, tableComponents } from '../../components/ResizableColumns'
import { useAuth } from '../../contexts/AuthContext'
import { listKafkaClusters, listConsumerGroups, getConsumerGroupDetail, deleteConsumerGroup, resetConsumerGroupOffsets } from '../../services/api'

const { Text } = Typography

export default function KafkaConsumerGroups() {
  const [clusterId, setClusterId] = useState<number | undefined>()
  const [groups, setGroups] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [detailCache, setDetailCache] = useState<{ [groupId: string]: any }>({})
  const [expandingGroups, setExpandingGroups] = useState<Set<string>>(new Set())
  const [refreshingGroups, setRefreshingGroups] = useState<Set<string>>(new Set())
  const [selectedRowKey, setSelectedRowKey] = useState<string | undefined>()
  const [selectedGroupKeys, setSelectedGroupKeys] = useState<string[]>([])
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{ label: string; onOk: () => void } | null>(null)
  const [deleteInput, setDeleteInput] = useState('')
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  const [batchDeleteInput, setBatchDeleteInput] = useState('')
  const [search, setSearch] = useState('')
  const [activeDetailRow, setActiveDetailRow] = useState<any>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetRecord, setResetRecord] = useState<any | null>(null)
  const [resetType, setResetType] = useState<'earliest' | 'latest' | 'timestamp' | 'offset'>('earliest')
  const [resetTimestamp, setResetTimestamp] = useState<dayjs.Dayjs | null>(null)
  const [resetLoading, setResetLoading] = useState(false)
  const [resetPartitionMode, setResetPartitionMode] = useState<'all' | 'select'>('all')
  const [resetSelectedPartitions, setResetSelectedPartitions] = useState<number[]>([])
  const [availablePartitions, setAvailablePartitions] = useState<any[]>([])
  const [partitionsLoading, setPartitionsLoading] = useState(false)
  const [partitionOffsets, setPartitionOffsets] = useState<Record<string, string>>({})
  const [resetResult, setResetResult] = useState<any[] | null>(null)
  const { hasPermission, isOwnScopeUser } = useAuth()
  const navigate = useNavigate()

  const fetchGroups = async () => {
    if (!clusterId) return
    setLoading(true)
    try {
      const res = await listConsumerGroups(clusterId)
      setGroups(res.data || [])
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to fetch consumer groups')
    }
    setLoading(false)
  }

  useEffect(() => { fetchGroups() }, [clusterId])

  // Clear cache when cluster changes
  useEffect(() => {
    setDetailCache({})
    setExpandingGroups(new Set())
    setSearch('')
    setActiveDetailRow(null)
  }, [clusterId])

  const loadGroupDetail = async (groupId: string) => {
    if (detailCache[groupId] || expandingGroups.has(groupId)) return
    setExpandingGroups(prev => new Set(prev).add(groupId))
    try {
      const res = await getConsumerGroupDetail(clusterId!, groupId)
      setDetailCache(prev => ({ ...prev, [groupId]: res.data }))
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to fetch details')
    }
    setExpandingGroups(prev => { const s = new Set(prev); s.delete(groupId); return s })
  }

  const forceLoadGroupDetail = async (groupId: string) => {
    if (expandingGroups.has(groupId) || refreshingGroups.has(groupId)) return
    setRefreshingGroups(prev => new Set(prev).add(groupId))
    try {
      const res = await getConsumerGroupDetail(clusterId!, groupId)
      setDetailCache(prev => ({ ...prev, [groupId]: res.data }))
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to fetch details')
    }
    setRefreshingGroups(prev => { const s = new Set(prev); s.delete(groupId); return s })
  }

  const handleBatchDelete = async () => {
    // deduplicate by group_id
    const groupIds = [...new Set(selectedGroupKeys.map(k => k.split('__')[0]))]
    setBatchDeleting(true)
    let failed = 0
    for (const gid of groupIds) {
      try {
        await deleteConsumerGroup(clusterId!, gid)
      } catch {
        failed++
      }
    }
    setBatchDeleting(false)
    setSelectedGroupKeys([])
    if (failed === 0) message.success(`Deleted ${groupIds.length} consumer group(s) successfully`)
    else message.warning(`${groupIds.length - failed} deleted, ${failed} failed`)
    fetchGroups()
  }

  const handleSingleDelete = async (groupId: string) => {
    try {
      await deleteConsumerGroup(clusterId!, groupId)
      message.success(`Deleted consumer group "${groupId}"`)
      fetchGroups()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Delete failed')
    }
  }

  const openResetModal = async (record: any) => {
    setResetRecord(record)
    setResetType('earliest')
    setResetTimestamp(null)
    setResetPartitionMode('all')
    setResetSelectedPartitions([])
    setPartitionOffsets({})
    setResetResult(null)
    setResetOpen(true)
    // Load partition info (use cache if available, otherwise fetch)
    setPartitionsLoading(true)
    try {
      let detail = detailCache[record.group_id]
      if (!detail) {
        const res = await getConsumerGroupDetail(clusterId!, record.group_id)
        detail = res.data
        setDetailCache(prev => ({ ...prev, [record.group_id]: detail }))
      }
      const topicDetail = (detail?.topics || []).find((t: any) => t.topic === record.topic)
      const parts = (topicDetail?.partitions || []).slice().sort((a: any, b: any) => a.partition - b.partition)
      setAvailablePartitions(parts)
    } catch {
      message.error('Failed to load partition info')
    } finally {
      setPartitionsLoading(false)
    }
  }

  const handleResetOffsets = async () => {
    if (!clusterId || !resetRecord) return
    if (resetType === 'timestamp' && !resetTimestamp) {
      message.warning('Please select a timestamp')
      return
    }
    const targetPids = resetPartitionMode === 'select' ? resetSelectedPartitions : availablePartitions.map((p: any) => p.partition)
    if (resetType === 'offset') {
      for (const pid of targetPids) {
        const val = partitionOffsets[String(pid)]
        if (val === undefined || val === '' || isNaN(Number(val))) {
          message.warning(`Please enter a valid offset for partition ${pid}`)
          return
        }
      }
    }
    setResetLoading(true)
    try {
      const partitions = resetPartitionMode === 'select' ? resetSelectedPartitions : undefined
      const partitionOffsetsNum: Record<string, number> = {}
      if (resetType === 'offset') {
        for (const pid of targetPids) {
          partitionOffsetsNum[String(pid)] = Number(partitionOffsets[String(pid)])
        }
      }
      const res = await resetConsumerGroupOffsets(clusterId, resetRecord.group_id, resetRecord.topic, resetType, {
        timestampMs: resetType === 'timestamp' ? resetTimestamp!.valueOf() : undefined,
        partitions,
        partitionOffsets: resetType === 'offset' ? partitionOffsetsNum : undefined,
      })
      setResetResult(res.data.changes || [])
      message.success('Offsets reset successfully')
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Reset failed')
    } finally {
      setResetLoading(false)
    }
  }

  const openDeleteConfirm = (label: string, onOk: () => void) => {
    setDeleteInput('')
    setDeleteConfirm({ label, onOk })
  }

  const filteredGroups = search
    ? groups.filter(g => (g.group_id || '').toLowerCase().includes(search.toLowerCase()))
    : groups

  // List columns: one row per (group, topic)
  const baseColumns = [
    {
      title: 'GroupID',
      key: 'group_id',
      dataIndex: 'group_id',
      width: 300,
      ellipsis: true,
      sorter: (a: any, b: any) => (a.group_id || '').localeCompare(b.group_id || ''),
      render: (v: string) => (
        <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>{v}</span>
      ),
      onCell: () => ({
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
        onDoubleClick: (e: React.MouseEvent) => {
          e.stopPropagation()
          const cell = e.currentTarget as HTMLElement
          const text = cell.innerText || cell.textContent || ''
          navigator.clipboard.writeText(text.trim()).then(() => message.success('Copied!', 1))
        },
      }),
    },
    {
      title: 'Topic', dataIndex: 'topic', width: 260, ellipsis: true,
      sorter: (a: any, b: any) => (a.topic || '').localeCompare(b.topic || ''),
      render: (topic: string) => (
        <a
          onClick={() => navigate(`/kafka/topics?cluster=${clusterId ?? ''}&topic=${encodeURIComponent(topic)}`)}
          style={{ color: '#1677ff' }}
        >
          {topic}
        </a>
      ),
    },
    {
      title: 'Consumer Lag', dataIndex: 'total_lag', width: 140,
      sorter: (a: any, b: any) => a.total_lag - b.total_lag,
      render: (v: number) => (
        <Tag color={v === 0 ? 'green' : v < 1000 ? 'orange' : 'red'}>{v}</Tag>
      ),
    },
    ...(hasPermission('kafka_consumer_group_delete') || isOwnScopeUser ? [{
      title: 'Actions',
      key: 'actions',
      width: 140,
      render: (_: any, r: any) => (
        <Space size={4}>
          <Button size="small" icon={<RetweetOutlined />} onClick={(e) => { e.stopPropagation(); openResetModal(r) }}>Reset</Button>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={(e) => { e.stopPropagation(); openDeleteConfirm(r.group_id, () => handleSingleDelete(r.group_id)) }}>Delete</Button>
        </Space>
      ),
    }] : []),
  ]
  const columns = useResizableColumns(baseColumns)

  // Partition detail columns shown in expanded row
  const partitionColumns = [
    { title: 'Partition ID', dataIndex: 'partition', width: 80, sorter: (a: any, b: any) => a.partition - b.partition, defaultSortOrder: 'ascend' as const },
    { title: 'Leader', dataIndex: 'leader', width: 80, sorter: (a: any, b: any) => a.leader - b.leader, render: (v: number) => v >= 0 ? <Tag color="blue">{v}</Tag> : '-' },
    { title: 'Log Start Offset', dataIndex: 'log_start_offset', width: 140, sorter: (a: any, b: any) => a.log_start_offset - b.log_start_offset, render: (v: number) => v >= 0 ? v : '-' },
    { title: 'Log End Offset', dataIndex: 'log_end_offset', width: 130, sorter: (a: any, b: any) => a.log_end_offset - b.log_end_offset, render: (v: number) => v >= 0 ? v : '-' },
    { title: 'Consumer Offset', dataIndex: 'consumer_offset', width: 140, sorter: (a: any, b: any) => a.consumer_offset - b.consumer_offset, render: (v: number) => v >= 0 ? v : '-' },
    {
      title: 'Lag', dataIndex: 'lag', width: 110,
      sorter: (a: any, b: any) => a.lag - b.lag,
      render: (v: number) => <Tag color={v === 0 ? 'green' : v < 1000 ? 'orange' : 'red'}>{v}</Tag>,
    },
    { title: 'Member ID', dataIndex: 'member_id', width: 320,
      sorter: (a: any, b: any) => (a.member_id || '').localeCompare(b.member_id || ''),
      onCell: () => ({ style: { whiteSpace: 'nowrap', overflow: 'hidden' } }),
      render: (v: string) => v
        ? <Tooltip title={v}><span style={{ fontFamily: 'monospace', direction: 'rtl', unicodeBidi: 'plaintext', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span></Tooltip>
        : '-' },
    { title: 'Client IP', dataIndex: 'client_host', width: 160, sorter: (a: any, b: any) => (a.client_host || '').localeCompare(b.client_host || ''), render: (v: string) => v ? v.replace(/^\//, '') : '-' },
  ]

  const tableRef = useRef<HTMLDivElement>(null)
  const [tableScrollY, setTableScrollY] = useState(500)
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
  useLayoutEffect(() => {
    const compute = () => {
      if (!tableRef.current) return
      const top = tableRef.current.getBoundingClientRect().top
      setTableScrollY(Math.max(200, window.innerHeight - top - 88))
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [groups.length, clusterId])
  const clampedDetailHeight = activeDetailRow
    ? Math.max(170, Math.min(detailPanelHeight, tableScrollY - 128))
    : 0
  const topScrollY = activeDetailRow ? Math.max(120, tableScrollY - clampedDetailHeight - 8) : tableScrollY

  return (
    <div>
      <div className="page-header" style={{ justifyContent: 'flex-start', gap: 16 }}>
        <h2 style={{ margin: 0, whiteSpace: 'nowrap' }}>Consumer Groups</h2>
        <ClusterSelector
          value={clusterId}
          onChange={setClusterId}
          fetchClusters={listKafkaClusters}
          placeholder="Select Kafka cluster"
        />
        <Space style={{ flex: 1, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
          {(hasPermission('kafka_consumer_group_delete') || isOwnScopeUser) && selectedGroupKeys.length > 0 && (
            <Button danger icon={<DeleteOutlined />} loading={batchDeleting} onClick={() => { setBatchDeleteInput(''); setBatchDeleteOpen(true) }}>
              Delete Selected ({[...new Set(selectedGroupKeys.map(k => k.split('__')[0]))].length})
            </Button>
          )}
          <Input.Search
            placeholder="Filter groups…"
            allowClear
            value={search}
            onChange={e => setSearch(e.target.value)}
            disabled={!clusterId}
            style={{ width: 220 }}
          />
          <Button icon={<ReloadOutlined />} onClick={fetchGroups} disabled={!clusterId} loading={loading}>Refresh</Button>
        </Space>
      </div>

      <div ref={tableRef} style={activeDetailRow ? { minHeight: topScrollY + 88 } : {}}>
      <Table
        rowKey={(r: any) => `${r.group_id}__${r.topic}`}
        components={tableComponents}
        columns={columns}
        dataSource={filteredGroups}
        loading={loading}
        size="small"
        locale={{ emptyText: (
          <div style={{ padding: '40px 0', color: '#87909a', fontSize: 14, textAlign: 'center' }}>
            {!clusterId ? '请选择集群以查看 Consumer Groups' : '暂无数据'}
          </div>
        ) }}
        rowSelection={(hasPermission('kafka_consumer_group_delete') || isOwnScopeUser) ? {
          selectedRowKeys: selectedGroupKeys,
          onChange: (keys) => {
            const newKeys = keys as string[]
            setSelectedGroupKeys(newKeys)
            if (newKeys.length === 1) {
              const [groupId, ...rest] = newKeys[0].split('__')
              const topic = rest.join('__')
              const row = filteredGroups.find((r: any) => r.group_id === groupId && r.topic === topic)
              if (row) { setActiveDetailRow(row); loadGroupDetail(groupId) }
            }
          },
        } : undefined}
        rowClassName={(r: any) =>
          activeDetailRow && `${r.group_id}__${r.topic}` === `${activeDetailRow.group_id}__${activeDetailRow.topic}`
            ? 'row-selected' : ''}
        onRow={(r: any) => ({
          onMouseEnter: () => setSelectedRowKey(`${r.group_id}__${r.topic}`),
          onClick: () => {
            if (activeDetailRow && r.group_id === activeDetailRow.group_id && r.topic === activeDetailRow.topic) {
              setActiveDetailRow(null)
            } else {
              setActiveDetailRow(r)
              loadGroupDetail(r.group_id)
            }
          },
          style: { cursor: 'pointer' },
        })}
        tableLayout="fixed"
        scroll={{ y: topScrollY }}
        pagination={{ defaultPageSize: 20, pageSizeOptions: ['20', '50', '100', '200'], showSizeChanger: true, showTotal: (total) => `${total} groups`, size: 'small' }}
      />
      </div>

      {activeDetailRow && (() => {
        const groupDetail = detailCache[activeDetailRow.group_id]
        const topicDetail = groupDetail
          ? (groupDetail.topics || []).find((t: any) => t.topic === activeDetailRow.topic)
          : null
        return (
          <>
            <div
              onMouseDown={handleDividerMouseDown}
              style={{ height: 8, background: '#e1e4e5', cursor: 'row-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none', flexShrink: 0 }}
            >
              <div style={{ width: 40, height: 3, background: '#adb5bd', borderRadius: 2 }} />
            </div>
            <div style={{ height: clampedDetailHeight, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', background: '#f8f9fa', borderBottom: '1px solid #e1e4e5', flexShrink: 0 }}>
                <Typography.Text strong>Partitions — {activeDetailRow.group_id} / {activeDetailRow.topic}</Typography.Text>
                <Space>
                  <Button size="small" icon={<ReloadOutlined />} loading={refreshingGroups.has(activeDetailRow.group_id)} onClick={() => forceLoadGroupDetail(activeDetailRow.group_id)}>Refresh</Button>
                  <Button size="small" onClick={() => setActiveDetailRow(null)}>✕</Button>
                </Space>
              </div>
              {expandingGroups.has(activeDetailRow.group_id) ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spin tip="Loading..." /></div>
              ) : !topicDetail ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Typography.Text type="secondary">No partition data</Typography.Text></div>
              ) : (
                <Table
                  rowKey="partition"
                  size="small"
                  columns={partitionColumns}
                  dataSource={topicDetail.partitions || []}
                  loading={refreshingGroups.has(activeDetailRow.group_id)}
                  pagination={{ defaultPageSize: 10, pageSizeOptions: ['10', '20', '50'], showSizeChanger: true, showTotal: (total) => `${total} partitions`, size: 'small' }}
                  tableLayout="fixed"
                  scroll={{ x: 1280, y: Math.max(40, clampedDetailHeight - 126) }}
                />
              )}
            </div>
          </>
        )
      })()}

      <Modal
        title="Reset Consumer Group Offsets"
        open={resetOpen}
        width={640}
        footer={resetResult ? (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button
              icon={<DownloadOutlined />}
              onClick={() => {
                const blob = new Blob([JSON.stringify(resetResult, null, 2)], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `offset-reset_${resetRecord?.group_id}_${resetRecord?.topic}_${Date.now()}.json`
                a.click()
                URL.revokeObjectURL(url)
              }}
            >
              Download JSON
            </Button>
            <Button type="primary" onClick={() => { setResetOpen(false); fetchGroups() }}>Close</Button>
          </div>
        ) : undefined}
        okText="Reset Offsets"
        okButtonProps={{ loading: resetLoading, danger: true, style: resetResult ? { display: 'none' } : {} }}
        cancelButtonProps={resetResult ? { style: { display: 'none' } } : {}}
        onOk={handleResetOffsets}
        onCancel={() => { setResetOpen(false); if (resetResult) fetchGroups() }}
        destroyOnClose
      >
        {resetResult ? (
          /* ── Result view ── */
          <div>
            <Alert type="success" showIcon message="Offsets reset successfully" style={{ marginBottom: 12 }} />
            <Table
              size="small"
              rowKey="partition"
              pagination={false}
              columns={[
                { title: 'Partition', dataIndex: 'partition', width: 90 },
                { title: 'Before Offset', dataIndex: 'before_offset', width: 130, render: (v: number) => v < 0 ? <Text type="secondary">-</Text> : v },
                { title: 'After Offset', dataIndex: 'after_offset', width: 130 },
                { title: 'Delta', key: 'delta', width: 100, render: (_: any, r: any) => {
                  const d = r.after_offset - (r.before_offset < 0 ? 0 : r.before_offset)
                  return <Tag color={d === 0 ? 'default' : d > 0 ? 'blue' : 'orange'}>{d > 0 ? `+${d}` : d}</Tag>
                }},
              ]}
              dataSource={resetResult}
              scroll={{ y: 240 }}
            />
            <Divider style={{ margin: '12px 0 8px' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>JSON</Text>
            <pre style={{ background: '#f5f5f5', borderRadius: 6, padding: '8px 12px', fontSize: 12, marginTop: 4, maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {JSON.stringify(resetResult, null, 2)}
            </pre>
          </div>
        ) : (
          /* ── Form view ── */
          <div>
            <Alert
              type="warning"
              showIcon
              message="The consumer group must be inactive (no running consumers) for the reset to take effect."
              style={{ marginBottom: 12 }}
            />
            <Space direction="vertical" style={{ width: '100%' }}>
              <div><Text strong>Group: </Text><Text code>{resetRecord?.group_id}</Text></div>
              <div><Text strong>Topic: </Text><Text code>{resetRecord?.topic}</Text></div>

              {/* Partition scope */}
              <div>
                <Text strong>Partitions: </Text>
                <Radio.Group
                  value={resetPartitionMode}
                  onChange={e => {
                    setResetPartitionMode(e.target.value)
                    setResetSelectedPartitions([])
                  }}
                  style={{ marginLeft: 8 }}
                >
                  <Radio value="all">All partitions</Radio>
                  <Radio value="select">Select partitions</Radio>
                </Radio.Group>
              </div>

              {/* Partition checklist */}
              {resetPartitionMode === 'select' && (
                partitionsLoading ? <Spin size="small" /> : (
                  <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #d9d9d9', borderRadius: 6, padding: '8px 12px' }}>
                    <Checkbox
                      indeterminate={resetSelectedPartitions.length > 0 && resetSelectedPartitions.length < availablePartitions.length}
                      checked={availablePartitions.length > 0 && resetSelectedPartitions.length === availablePartitions.length}
                      onChange={e => setResetSelectedPartitions(e.target.checked ? availablePartitions.map((p: any) => p.partition) : [])}
                    >
                      <Text strong>Select All</Text>
                    </Checkbox>
                    <Divider style={{ margin: '6px 0' }} />
                    {availablePartitions.map((p: any) => (
                      <div key={p.partition} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <Checkbox
                          checked={resetSelectedPartitions.includes(p.partition)}
                          onChange={e => {
                            if (e.target.checked) setResetSelectedPartitions(prev => [...prev, p.partition].sort((a, b) => a - b))
                            else setResetSelectedPartitions(prev => prev.filter(x => x !== p.partition))
                          }}
                        >
                          Partition {p.partition}
                        </Checkbox>
                        {resetType === 'offset' && resetSelectedPartitions.includes(p.partition) && (
                          <>
                            <InputNumber
                              size="small"
                              placeholder="target offset"
                              value={partitionOffsets[String(p.partition)] !== undefined ? Number(partitionOffsets[String(p.partition)]) : undefined}
                              min={p.log_start_offset >= 0 ? p.log_start_offset : 0}
                              max={p.log_end_offset >= 0 ? p.log_end_offset : undefined}
                              onChange={v => setPartitionOffsets(prev => ({ ...prev, [String(p.partition)]: String(v ?? '') }))}
                              style={{ width: 130 }}
                            />
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              [{p.log_start_offset >= 0 ? p.log_start_offset : '?'}, {p.log_end_offset >= 0 ? p.log_end_offset : '?'}]
                            </Text>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* Reset type */}
              <div>
                <Text strong>Reset to:</Text>
                <Radio.Group value={resetType} onChange={e => setResetType(e.target.value)} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                  <Radio value="earliest">Earliest (oldest available message)</Radio>
                  <Radio value="latest">Latest (newest / end of topic)</Radio>
                  <Radio value="timestamp">By Timestamp (first offset at or after the time)</Radio>
                  <Radio value="offset">By Offset (specify exact offset per partition)</Radio>
                </Radio.Group>
              </div>

              {/* Timestamp picker */}
              {resetType === 'timestamp' && (
                <DatePicker
                  showTime
                  value={resetTimestamp}
                  onChange={v => setResetTimestamp(v)}
                  disabledDate={d => d.isAfter(dayjs())}
                  style={{ width: '100%' }}
                  placeholder="Select local date & time"
                />
              )}

              {/* Per-partition offset inputs when mode=all and type=offset */}
              {resetType === 'offset' && resetPartitionMode === 'all' && (
                partitionsLoading ? <Spin size="small" /> : (
                  <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #d9d9d9', borderRadius: 6, padding: '8px 12px' }}>
                    {availablePartitions.map((p: any) => (
                      <div key={p.partition} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <Text style={{ width: 100, flexShrink: 0 }}>Partition {p.partition}</Text>
                        <InputNumber
                          size="small"
                          placeholder="target offset"
                          value={partitionOffsets[String(p.partition)] !== undefined ? Number(partitionOffsets[String(p.partition)]) : undefined}
                          min={p.log_start_offset >= 0 ? p.log_start_offset : 0}
                          max={p.log_end_offset >= 0 ? p.log_end_offset : undefined}
                          onChange={v => setPartitionOffsets(prev => ({ ...prev, [String(p.partition)]: String(v ?? '') }))}
                          style={{ width: 140 }}
                        />
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          [{p.log_start_offset >= 0 ? p.log_start_offset : '?'}, {p.log_end_offset >= 0 ? p.log_end_offset : '?'}]
                        </Text>
                      </div>
                    ))}
                  </div>
                )
              )}
            </Space>
          </div>
        )}
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
        title={`Delete ${[...new Set(selectedGroupKeys.map(k => k.split('__')[0]))].length} consumer group(s)`}
        open={batchDeleteOpen}
        okText="Delete"
        okButtonProps={{ danger: true, disabled: batchDeleteInput !== 'delete' }}
        onOk={() => { setBatchDeleteOpen(false); handleBatchDelete() }}
        onCancel={() => setBatchDeleteOpen(false)}
        destroyOnClose
      >
        <p>You are about to permanently delete <strong>{[...new Set(selectedGroupKeys.map(k => k.split('__')[0]))].length}</strong> consumer group(s). This action cannot be undone.</p>
        <p>Type <strong>delete</strong> to confirm:</p>
        <Input
          value={batchDeleteInput}
          onChange={e => setBatchDeleteInput(e.target.value)}
          onPressEnter={() => { if (batchDeleteInput === 'delete') { setBatchDeleteOpen(false); handleBatchDelete() } }}
          autoFocus
          placeholder="delete"
        />
      </Modal>
    </div>
  )
}
