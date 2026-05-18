import React, { useEffect, useState } from 'react'
import { Table, Button, message, Space, Tag, Modal, Input } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons'
import { listZKClusters, getZKCluster, createZKCluster, updateZKCluster, deleteZKCluster } from '../../services/api'
import ZKClusterModal from '../../components/ZKClusterModal'
import { useResizableColumns, tableComponents } from '../../components/ResizableColumns'
import { useAuth } from '../../contexts/AuthContext'

export default function ZKClusters() {
  const [clusters, setClusters] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ label: string; onOk: () => void } | null>(null)
  const [deleteInput, setDeleteInput] = useState('')
  const { hasPermission, user } = useAuth()

  const fetchClusters = async () => {
    setLoading(true)
    try {
      const res = await listZKClusters()
      setClusters(res.data || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchClusters() }, [])

  const handleSubmit = async (values: any) => {
    try {
      if (editing) {
        await updateZKCluster(editing.id, values)
        message.success('Updated successfully')
      } else {
        await createZKCluster(values)
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
    try {
      await deleteZKCluster(id)
      message.success('Deleted successfully')
      fetchClusters()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Delete failed')
    }
  }

  const openEdit = async (record: any) => {
    try {
      const res = await getZKCluster(record.id)
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

  const schemeColor: Record<string, string> = { none: 'default', digest: 'blue', sasl: 'purple' }

  const baseColumns = [
    { title: 'ID', dataIndex: 'id', width: 70, defaultSortOrder: 'ascend' as const, sorter: (a: any, b: any) => a.id - b.id },
    { title: 'Cluster Name', dataIndex: 'name', width: 180, sorter: (a: any, b: any) => (a.name || '').localeCompare(b.name || '') },
    { title: 'Description', dataIndex: 'description', width: 200, sorter: (a: any, b: any) => (a.description || '').localeCompare(b.description || ''), render: (v: string) => v || '-' },
    { title: 'Servers', dataIndex: 'servers', width: 280, sorter: (a: any, b: any) => (a.servers || '').localeCompare(b.servers || '') },
    {
      title: 'Auth Scheme', dataIndex: 'auth_scheme', width: 130,
      sorter: (a: any, b: any) => (a.auth_scheme || '').localeCompare(b.auth_scheme || ''),
      render: (v: string) => <Tag color={schemeColor[v] || 'default'}>{(v || 'none').toUpperCase()}</Tag>,
    },
    { title: 'Username', dataIndex: 'username', width: 120, sorter: (a: any, b: any) => (a.username || '').localeCompare(b.username || ''), render: (v: string) => v || '-' },
    {
      title: 'Actions', width: 160,
      render: (_: any, record: any) => (
        <Space>
          {(hasPermission('zk_cluster_edit') || record.created_by === user?.id) && (
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>Edit</Button>
          )}
          {(hasPermission('zk_cluster_delete') || record.created_by === user?.id) && (
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => openDeleteConfirm(record.name, () => handleDelete(record.id))}>Delete</Button>
          )}
        </Space>
      ),
    },
  ]
  const columns = useResizableColumns(baseColumns)

  return (
    <div>
      <div className="page-header">
        <h2 style={{ margin: 0 }}>ZooKeeper Clusters</h2>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchClusters} loading={loading}>Refresh</Button>
          {hasPermission('zk_cluster_add') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); setModalOpen(true) }}>
              Add Cluster
            </Button>
          )}
        </Space>
      </div>
      <Table rowKey="id" components={tableComponents} columns={columns} dataSource={clusters} loading={loading} />
      <ZKClusterModal
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
        />
      </Modal>
    </div>
  )
}
