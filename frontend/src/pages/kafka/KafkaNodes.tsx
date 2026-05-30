import React, { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { Table, message, Space, Button, Tag, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import ClusterSelector from '../../components/ClusterSelector'
import { useResizableColumns, tableComponents } from '../../components/ResizableColumns'
import { listKafkaClusters, listKafkaBrokers, listBrokerPartitions } from '../../services/api'

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  if (bytes >= 1099511627776) return `${(bytes / 1099511627776).toFixed(2)} TB`
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${bytes} B`
}

export default function KafkaNodes({ fixedClusterId }: { fixedClusterId?: number } = {}) {
  const [clusterId, setClusterId] = useState<number | undefined>(fixedClusterId)
  const [brokers, setBrokers] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedBroker, setSelectedBroker] = useState<any | null>(null)
  const [partitions, setPartitions] = useState<any[]>([])
  const [partLoading, setPartLoading] = useState(false)
  const [partLoaded, setPartLoaded] = useState<Record<number, boolean>>({})

  const containerRef = useRef<HTMLDivElement>(null)
  const [containerHeight, setContainerHeight] = useState(500)
  const [splitPos, setSplitPos] = useState(280)
  const dragRef = useRef({ dragging: false, startY: 0, startPos: 0 })

  useLayoutEffect(() => {
    const measure = () => {
      if (!containerRef.current) return
      const top = containerRef.current.getBoundingClientRect().top
      setContainerHeight(Math.max(300, window.innerHeight - top - 88))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [brokers.length, clusterId])

  const topHeight = selectedBroker
    ? Math.max(140, Math.min(splitPos, containerHeight - 180))
    : containerHeight

  const fetchBrokers = async () => {
    if (!clusterId) return
    setLoading(true)
    setSelectedBroker(null)
    setPartitions([])
    setPartLoaded({})
    try {
      const res = await listKafkaBrokers(clusterId)
      setBrokers(res.data || [])
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to fetch brokers')
    }
    setLoading(false)
  }

  const fetchPartitions = async (broker: any) => {
    if (!clusterId) return
    setPartLoading(true)
    try {
      const res = await listBrokerPartitions(clusterId, broker.id)
      setPartitions(res.data || [])
      setPartLoaded(prev => ({ ...prev, [broker.id]: true }))
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to fetch partitions')
    }
    setPartLoading(false)
  }

  useEffect(() => { fetchBrokers() }, [clusterId])

  const handleRowClick = (record: any) => {
    if (selectedBroker?.id === record.id) {
      setSelectedBroker(null)
      setPartitions([])
    } else {
      setSelectedBroker(record)
      fetchPartitions(record)
    }
  }

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { dragging: true, startY: e.clientY, startPos: splitPos }
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientY - dragRef.current.startY
      setSplitPos(Math.max(140, Math.min(containerHeight - 180, dragRef.current.startPos + delta)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const brokerColumns = useResizableColumns([
    {
      title: 'Broker ID',
      dataIndex: 'id',
      width: 100,
      defaultSortOrder: 'ascend' as const,
      sorter: (a: any, b: any) => a.id - b.id,
    },
    {
      title: 'Listener',
      dataIndex: 'addr',
      width: 220,
      sorter: (a: any, b: any) => (a.addr || '').localeCompare(b.addr || ''),
      render: (v: string) => v || '-',
    },
    {
      title: 'Advertised Listener',
      dataIndex: 'advertised_listeners',
      width: 300,
      ellipsis: true,
      sorter: (a: any, b: any) => (a.advertised_listeners || '').localeCompare(b.advertised_listeners || ''),
      render: (v: string) => v || '-',
    },
    {
      title: 'Leader Partitions',
      dataIndex: 'leader_count',
      width: 150,
      sorter: (a: any, b: any) => (a.leader_count || 0) - (b.leader_count || 0),
    },
    {
      title: 'Total Partitions',
      dataIndex: 'partition_count',
      width: 150,
      sorter: (a: any, b: any) => (a.partition_count || 0) - (b.partition_count || 0),
    },
    {
      title: 'Log Size',
      dataIndex: 'log_size',
      width: 120,
      sorter: (a: any, b: any) => (a.log_size || 0) - (b.log_size || 0),
      render: (v: number) => formatBytes(v),
    },
  ])

  const partColumns = useResizableColumns([
    {
      title: 'Topic',
      dataIndex: 'topic',
      width: 220,
      ellipsis: true,
      defaultSortOrder: 'ascend' as const,
      sorter: (a: any, b: any) => (a.topic || '').localeCompare(b.topic || ''),
    },
    {
      title: 'Partition',
      dataIndex: 'partition_id',
      width: 90,
      sorter: (a: any, b: any) => a.partition_id - b.partition_id,
    },
    {
      title: 'Role',
      dataIndex: 'is_leader',
      width: 90,
      filters: [{ text: 'Leader', value: true }, { text: 'Follower', value: false }],
      onFilter: (value: any, record: any) => record.is_leader === value,
      render: (v: boolean) => v
        ? <Tag color="blue">Leader</Tag>
        : <Tag color="default">Follower</Tag>,
    },
    {
      title: 'Log Size',
      dataIndex: 'log_size',
      width: 120,
      sorter: (a: any, b: any) => (a.log_size || 0) - (b.log_size || 0),
      render: (v: number) => formatBytes(v),
    },
  ])

  const bottomHeight = selectedBroker
    ? Math.max(120, containerHeight - topHeight - 8)
    : 0

  return (
    <div ref={containerRef} style={selectedBroker ? { minHeight: containerHeight + 88 } : {}}>
      <div className="page-header">
        {!fixedClusterId && (
          <Space>
            <h2 style={{ margin: 0 }}>Kafka Nodes</h2>
            <ClusterSelector
              value={clusterId}
              onChange={setClusterId}
              fetchClusters={listKafkaClusters}
              placeholder="Select Kafka cluster"
            />
          </Space>
        )}
        <Button icon={<ReloadOutlined />} onClick={fetchBrokers} disabled={!clusterId} loading={loading}>
          Refresh
        </Button>
      </div>

      <Table
        rowKey="id"
        components={tableComponents}
        columns={brokerColumns}
        dataSource={brokers}
        loading={loading}
        size="small"
        scroll={{ x: 'max-content', y: topHeight }}
        rowClassName={(r) => r.id === selectedBroker?.id ? 'row-selected' : ''}
        onRow={(record) => ({
          onClick: () => handleRowClick(record),
          style: { cursor: 'pointer' },
        })}
        locale={{ emptyText: clusterId ? 'No broker data' : 'Please select a cluster' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, showTotal: n => `${n} brokers`, size: 'small' }}
      />

      {selectedBroker && (
        <>
          <div
            onMouseDown={onDragStart}
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

          <div style={{ height: bottomHeight, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 12px',
              background: '#f8f9fa',
              borderBottom: '1px solid #e1e4e5',
              flexShrink: 0,
            }}>
              <Typography.Text strong>
                Partitions — Broker {selectedBroker.id} ({selectedBroker.addr})
              </Typography.Text>
              <Space>
                <Button size="small" icon={<ReloadOutlined />} loading={partLoading} onClick={() => fetchPartitions(selectedBroker)}>
                  Refresh
                </Button>
                <Button size="small" onClick={() => { setSelectedBroker(null); setPartitions([]) }}>✕</Button>
              </Space>
            </div>

            <Table
              rowKey={(r) => `${r.topic}-${r.partition_id}`}
              components={tableComponents}
              columns={partColumns}
              dataSource={partitions}
              loading={partLoading}
              size="small"
              scroll={{ x: 'max-content', y: Math.max(60, bottomHeight - 130) }}
              pagination={{
                defaultPageSize: 20,
                pageSizeOptions: ['20', '50', '100', '200'],
                showSizeChanger: true,
                showTotal: n => `${n} partitions`,
                size: 'small',
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}
