import React, { useState, useEffect } from 'react'
import { Table, message, Space, Button, Tag, Progress, Tooltip } from 'antd'
import ClusterSelector from '../../components/ClusterSelector'
import { useResizableColumns, tableComponents } from '../../components/ResizableColumns'
import { listESClusters, listESNodes } from '../../services/api'

export default function ESNodes({ fixedClusterId }: { fixedClusterId?: number } = {}) {
  const [clusterId, setClusterId] = useState<number | undefined>(fixedClusterId)
  const [nodes, setNodes] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  const fetchNodes = async () => {
    if (!clusterId) return
    setLoading(true)
    try {
      const res = await listESNodes(clusterId)
      setNodes(res.data || [])
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to fetch nodes')
    }
    setLoading(false)
  }

  useEffect(() => { fetchNodes() }, [clusterId])

  const roleColor: Record<string, string> = {
    m: 'purple', d: 'blue', i: 'cyan', c: 'orange'
  }

  const parseRole = (role: string) => {
    if (!role) return []
    return role.split('').map(r => {
      const map: Record<string, string> = { m: 'master', d: 'data', i: 'ingest', c: 'coord' }
      return { char: r, label: map[r] || r }
    })
  }

  const baseColumns = [
    { title: 'Node Name', dataIndex: 'name', width: 180, defaultSortOrder: 'ascend' as const, sorter: (a: any, b: any) => (a.name || '').localeCompare(b.name || '') },
    { title: 'IP', dataIndex: 'ip', width: 130, sorter: (a: any, b: any) => (a.ip || '').localeCompare(b.ip || '') },
    {
      title: 'Role', dataIndex: 'node.role', width: 130,
      sorter: (a: any, b: any) => (a['node.role'] || '').localeCompare(b['node.role'] || ''),
      render: (v: string) => parseRole(v).map(r => (
        <Tooltip key={r.char} title={r.label}>
          <Tag color={roleColor[r.char] || 'default'}>{r.char.toUpperCase()}</Tag>
        </Tooltip>
      )),
    },
    {
      title: 'CPU%', dataIndex: 'cpu', width: 120,
      sorter: (a: any, b: any) => (parseInt(a.cpu) || 0) - (parseInt(b.cpu) || 0),
      render: (v: string) => {
        const pct = parseInt(v) || 0
        return <Progress percent={pct} size="small" status={pct > 80 ? 'exception' : 'normal'} />
      },
    },
    {
      title: 'Heap%', dataIndex: 'heap.percent', width: 120,
      sorter: (a: any, b: any) => (parseInt(a['heap.percent']) || 0) - (parseInt(b['heap.percent']) || 0),
      render: (v: string) => {
        const pct = parseInt(v) || 0
        return <Progress percent={pct} size="small" status={pct > 80 ? 'exception' : 'normal'} />
      },
    },
    { title: '1m Load', dataIndex: 'load_1m', width: 90, sorter: (a: any, b: any) => parseFloat(a.load_1m || '0') - parseFloat(b.load_1m || '0') },
    { title: 'Shards', dataIndex: 'shards', width: 75, sorter: (a: any, b: any) => (parseInt(a.shards) || 0) - (parseInt(b.shards) || 0) },
    {
      title: 'Disk%', dataIndex: 'disk.percent', width: 140,
      sorter: (a: any, b: any) => (parseInt(a['disk.percent']) || 0) - (parseInt(b['disk.percent']) || 0),
      render: (v: string) => {
        const pct = parseInt(v) || 0
        return v ? <Progress percent={pct} size="small" status={pct > 85 ? 'exception' : pct > 70 ? 'normal' : 'success'} /> : '-'
      },
    },
    {
      title: 'Disk Indices', dataIndex: 'disk.indices', width: 110,
      sorter: (a: any, b: any) => (a['disk.indices'] || '').localeCompare(b['disk.indices'] || ''),
      render: (v: string) => v || '-',
    },
    {
      title: 'Disk Used / Total', key: 'disk_used_total', width: 160,
      sorter: (a: any, b: any) => (a['disk.used'] || '').localeCompare(b['disk.used'] || ''),
      render: (_: any, r: any) => {
        const used = r['disk.used'], total = r['disk.total']
        return used && total ? `${used} / ${total}` : (used || total || '-')
      },
    },
    { title: 'Disk Avail', dataIndex: 'disk.avail', width: 100, sorter: (a: any, b: any) => (a['disk.avail'] || '').localeCompare(b['disk.avail'] || '') },
  ]
  const columns = useResizableColumns(baseColumns)

  return (
    <div>
      <div className="page-header">
        {!fixedClusterId && (
          <Space>
            <h2 style={{ margin: 0 }}>Nodes</h2>
            <ClusterSelector
              value={clusterId}
              onChange={setClusterId}
              fetchClusters={listESClusters}
              placeholder="Select ES cluster"
            />
          </Space>
        )}
        <Button onClick={fetchNodes} disabled={!clusterId}>Refresh</Button>
      </div>
      <Table rowKey="name" components={tableComponents} columns={columns} dataSource={nodes} loading={loading} tableLayout="fixed" scroll={{ x: 1380 }} />
    </div>
  )
}
