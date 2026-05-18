import React, { useEffect, useState, useRef, useLayoutEffect } from 'react'
import { Table, Button, message, Tag, Space, Modal, Input } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons'
import { listKafkaClusters, getKafkaCluster, createKafkaCluster, updateKafkaCluster, deleteKafkaCluster } from '../../services/api'
import KafkaClusterModal from '../../components/KafkaClusterModal'
import { useResizableColumns, tableComponents } from '../../components/ResizableColumns'
import { useAuth } from '../../contexts/AuthContext'

export default function KafkaClusters() {
  const [clusters, setClusters] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [search, setSearch] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<{ label: string; onOk: () => void } | null>(null)
  const [deleteInput, setDeleteInput] = useState('')
  const { hasPermission, user } = useAuth()

  const filteredClusters = search
    ? clusters.filter(c => {
        const q = search.toLowerCase()
        return (
          (c.name || '').toLowerCase().includes(q) ||
          (c.description || '').toLowerCase().includes(q) ||
          (c.auth_type || '').toLowerCase().includes(q) ||
          (c.version || '').toLowerCase().includes(q) ||
          (c.nodes || []).some((n: any) => `${n.host}:${n.port}`.toLowerCase().includes(q))
        )
      })
    : clusters

  const fetchClusters = async () => {
    setLoading(true)
    const res = await listKafkaClusters()
    const list: any[] = res.data || []
    setClusters(list)
    setLoading(false)
  }

  useEffect(() => { fetchClusters() }, [])

  const handleSubmit = async (values: any) => {
    try {
      if (editing) {
        await updateKafkaCluster(editing.id, values)
        message.success('Updated successfully')
      } else {
        await createKafkaCluster(values)
        message.success('Created successfully')
      }
      setModalOpen(false)
      setEditing(null)
      fetchClusters()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Operation failed')
    }
  }

  const handleDelete = async (id: number) => {
    await deleteKafkaCluster(id)
    message.success('Deleted successfully')
    fetchClusters()
  }

  const openEdit = async (record: any) => {
    try {
      const res = await getKafkaCluster(record.id)
      setEditing(res.data)
    } catch {
      setEditing(record)
    }
    setModalOpen(true)
  }

  const openDeleteConfirm = (label: string, onOk: () => void) => {
    setDeleteInput('')
    setDeleteConfirm({ label, onOk })
  }

  const authTypeColor: Record<string, string> = {
    PLAINTEXT: 'default',
    SASL_PLAIN: 'blue',
    'SCRAM-SHA-256': 'green',
    'SCRAM-SHA-512': 'purple',
  }

  const baseColumns = [
    { title: 'ID', dataIndex: 'id', width: 70, defaultSortOrder: 'ascend' as const, sorter: (a: any, b: any) => a.id - b.id },
    { title: 'Cluster Name', dataIndex: 'name', width: 180, sorter: (a: any, b: any) => (a.name || '').localeCompare(b.name || '') },
    { title: 'Description', dataIndex: 'description', width: 220, sorter: (a: any, b: any) => (a.description || '').localeCompare(b.description || '') },
    {
      title: 'Auth Type', dataIndex: 'auth_type', width: 150,
      sorter: (a: any, b: any) => (a.auth_type || '').localeCompare(b.auth_type || ''),
      render: (v: string) => <Tag color={authTypeColor[v] || 'default'}>{v}</Tag>,
    },
    {
      title: 'Nodes', dataIndex: 'nodes', width: 240,
      render: (nodes: any[]) => (nodes || []).map((n: any) => `${n.host}:${n.port}`).join(', '),
    },
    {
      title: 'Version', dataIndex: 'version', width: 120,
      render: (v: string) => v ? <Tag color="blue">{v}</Tag> : <Tag color="default">—</Tag>,
    },
    {
      title: 'Actions', width: 150,
      render: (_: any, record: any) => (
        <Space>
          {(hasPermission('kafka_cluster_edit') || record.created_by === user?.id) && (
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>Edit</Button>
          )}
          {(hasPermission('kafka_cluster_delete') || record.created_by === user?.id) && (
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => openDeleteConfirm(record.name, () => handleDelete(record.id))}>Delete</Button>
          )}
        </Space>
      ),
    },
  ]
  const columns = useResizableColumns(baseColumns)

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
  }, [])

  return (
    <div>
      <div className="page-header">
        <h2 style={{ margin: 0 }}>Kafka Clusters</h2>
        <Space>
          <Input.Search
            placeholder="Filter clusters…"
            allowClear
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: 240 }}
          />
          <Button icon={<ReloadOutlined />} onClick={fetchClusters} loading={loading}>Refresh</Button>
          {hasPermission('kafka_cluster_add') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); setModalOpen(true) }}>
              Add Cluster
            </Button>
          )}
        </Space>
      </div>
      <div ref={tableRef}>
      <Table rowKey="id" components={tableComponents} columns={columns} dataSource={filteredClusters} loading={loading} tableLayout="fixed" scroll={{ x: 800, y: tableScrollY }} />
      </div>
      <KafkaClusterModal
        open={modalOpen}
        title={editing ? 'Edit Cluster' : 'Add Cluster'}
        initialValues={editing}
        onCancel={() => { setModalOpen(false); setEditing(null) }}
        onSubmit={handleSubmit}
      />

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
    </div>
  )
}
