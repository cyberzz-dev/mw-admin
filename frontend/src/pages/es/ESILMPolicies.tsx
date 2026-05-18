import React, { useState, useEffect } from 'react'
import {
  Table, message, Space, Button, Tag, Input, Switch, Modal, Drawer, Typography, Tooltip,
} from 'antd'
import { EyeOutlined } from '@ant-design/icons'
import ClusterSelector from '../../components/ClusterSelector'
import { useResizableColumns, tableComponents } from '../../components/ResizableColumns'
import {
  listESClusters, listESILMPolicies,
  deleteESILMPolicy, bulkDeleteESILMPolicies, putESILMPolicy,
} from '../../services/api'

const { Text } = Typography

const phaseColor: Record<string, string> = {
  hot: 'red', warm: 'orange', cold: 'blue', frozen: 'cyan', delete: 'default',
}
const phaseOrder = ['hot', 'warm', 'cold', 'frozen', 'delete']

export default function ESILMPolicies() {
  const [clusterId, setClusterId] = useState<number | undefined>()
  const [policies, setPolicies] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [hideSystem, setHideSystem] = useState(true)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

  // View drawer (read-only)
  const [viewRecord, setViewRecord] = useState<any>(null)

  // Edit/Create modal
  const [editRecord, setEditRecord] = useState<any>(null)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editJson, setEditJson] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  // Delete confirm modal
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const fetchPolicies = async () => {
    if (!clusterId) return
    setLoading(true)
    try {
      const res = await listESILMPolicies(clusterId)
      setPolicies(res.data || [])
      setSelectedRowKeys([])
      setSearch('')
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to fetch ILM policies')
    }
    setLoading(false)
  }

  useEffect(() => { fetchPolicies() }, [clusterId])

  const displayData = policies.filter(p => {
    if (hideSystem && p.name?.startsWith('.')) return false
    if (search && !p.name?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const formatDate = (s: string) => {
    if (!s) return '-'
    try { return new Date(s).toLocaleString() } catch { return s }
  }

  const sortPhases = (phases: string[]) =>
    [...(phases || [])].sort((a, b) => {
      const ai = phaseOrder.indexOf(a)
      const bi = phaseOrder.indexOf(b)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })

  // ---- View ----
  const openView = (record: any) => setViewRecord(record)

  // ---- Edit / Create ----
  const openEdit = (record: any) => {
    setEditRecord(record)
    setEditName(record.name)
    const raw = record.raw_json
    try {
      setEditJson(JSON.stringify(typeof raw === 'string' ? JSON.parse(raw) : raw, null, 2))
    } catch {
      setEditJson(typeof raw === 'string' ? raw : '{}')
    }
    setEditModalOpen(true)
  }

  const openCreate = () => {
    setEditRecord(null)
    setEditName('')
    setEditJson('{\n  "policy": {\n    "phases": {}\n  }\n}')
    setEditModalOpen(true)
  }

  const handleSave = async () => {
    if (!clusterId) return
    const name = editRecord ? editRecord.name : editName.trim()
    if (!name) { message.error('Policy name is required'); return }
    setEditSaving(true)
    try {
      const body = JSON.parse(editJson)
      await putESILMPolicy(clusterId, name, body)
      message.success(`Policy "${name}" saved`)
      setEditModalOpen(false)
      fetchPolicies()
    } catch (e: any) {
      message.error(e.response?.data?.error || e.message || 'Save failed')
    }
    setEditSaving(false)
  }

  // ---- Delete ----
  const handleDelete = async () => {
    if (!clusterId || !deleteTarget) return
    setDeleteLoading(true)
    try {
      await deleteESILMPolicy(clusterId, deleteTarget)
      message.success(`Deleted "${deleteTarget}"`)
      setDeleteTarget(null)
      fetchPolicies()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Delete failed')
    }
    setDeleteLoading(false)
  }

  const handleBulkDelete = () => {
    if (!clusterId || selectedRowKeys.length === 0) return
    Modal.confirm({
      title: `Delete ${selectedRowKeys.length} ILM policies?`,
      content: 'This action cannot be undone.',
      okText: 'Delete',
      okType: 'danger',
      onOk: async () => {
        try {
          await bulkDeleteESILMPolicies(clusterId, selectedRowKeys as string[])
          message.success(`Deleted ${selectedRowKeys.length} policies`)
          fetchPolicies()
        } catch (e: any) {
          message.error(e.response?.data?.error || 'Bulk delete failed')
        }
      },
    })
  }

  const baseColumns = [
    {
      title: 'Policy Name', dataIndex: 'name', width: 240,
      defaultSortOrder: 'ascend' as const,
      sorter: (a: any, b: any) => (a.name || '').localeCompare(b.name || ''),
    },
    {
      title: 'Phases', dataIndex: 'phases', width: 240,
      render: (v: string[]) =>
        sortPhases(v).map(phase => (
          <Tooltip key={phase} title={phase}>
            <Tag color={phaseColor[phase] || 'default'}>{phase}</Tag>
          </Tooltip>
        )),
    },
    {
      title: 'Version', dataIndex: 'version', width: 80,
      sorter: (a: any, b: any) => (a.version || 0) - (b.version || 0),
      render: (v: number) => v ?? <Text type="secondary">-</Text>,
    },
    {
      title: 'Modified Date', dataIndex: 'modified_date', width: 180,
      sorter: (a: any, b: any) => (a.modified_date || '').localeCompare(b.modified_date || ''),
      render: (v: string) => formatDate(v),
    },
    {
      title: 'Actions', width: 200, fixed: 'right' as const,
      render: (_: any, record: any) => (
        <Space size={4}>
          <Button size="small" icon={<EyeOutlined />} onClick={() => openView(record)}>View</Button>
          <Button size="small" onClick={() => openEdit(record)}>Edit</Button>
          <Button size="small" danger onClick={() => setDeleteTarget(record.name)}>Delete</Button>
        </Space>
      ),
    },
  ]
  const columns = useResizableColumns(baseColumns)

  return (
    <div>
      <div className="page-header">
        <Space>
          <h2 style={{ margin: 0 }}>ILM Policies</h2>
          <ClusterSelector
            value={clusterId}
            onChange={setClusterId}
            fetchClusters={listESClusters}
            placeholder="Select ES cluster"
          />
        </Space>
        <Space>
          <Switch
            checked={hideSystem}
            onChange={setHideSystem}
            checkedChildren="Hide system"
            unCheckedChildren="Show system"
          />
          {selectedRowKeys.length > 0 && (
            <Button danger onClick={handleBulkDelete}>Delete ({selectedRowKeys.length})</Button>
          )}
          <Button type="primary" onClick={openCreate} disabled={!clusterId}>Create</Button>
          <Input.Search
            placeholder="Search policy name"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: 260 }}
            allowClear
          />
          <Button onClick={fetchPolicies} disabled={!clusterId}>Refresh</Button>
        </Space>
      </div>

      <Table
        rowKey="name"
        rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
        components={tableComponents}
        columns={columns}
        dataSource={displayData}
        loading={loading}
        size="small"
        tableLayout="fixed"
        scroll={{ x: 1000 }}
      />

      {/* View drawer (read-only) */}
      <Drawer
        title={viewRecord?.name}
        open={!!viewRecord}
        onClose={() => setViewRecord(null)}
        width={640}
        styles={{ body: { padding: 16 } }}
      >
        {viewRecord && (
          <pre style={{ background: '#f5f5f5', border: '1px solid #e5e7e8', borderRadius: 4, padding: 12, fontSize: 12, overflowX: 'auto', margin: 0 }}>
            {JSON.stringify(
              typeof viewRecord.raw_json === 'string' ? JSON.parse(viewRecord.raw_json) : viewRecord.raw_json,
              null, 2
            )}
          </pre>
        )}
      </Drawer>

      {/* Edit / Create modal */}
      <Modal
        title={editRecord ? `Edit policy: ${editRecord.name}` : 'Create ILM policy'}
        open={editModalOpen}
        onCancel={() => setEditModalOpen(false)}
        onOk={handleSave}
        okText="Save"
        confirmLoading={editSaving}
        width={720}
        destroyOnClose
      >
        {!editRecord && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4 }}>Policy name</label>
            <Input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              placeholder="my-policy"
              autoFocus
            />
          </div>
        )}
        <label style={{ display: 'block', marginBottom: 4 }}>Policy JSON</label>
        <textarea
          value={editJson}
          onChange={e => setEditJson(e.target.value)}
          style={{ width: '100%', minHeight: 400, fontFamily: 'monospace', fontSize: 12, resize: 'vertical', padding: 8 }}
        />
      </Modal>

      {/* Delete confirmation modal */}
      <Modal
        title={`Delete policy "${deleteTarget}"?`}
        open={!!deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onOk={handleDelete}
        okText="Delete"
        okType="danger"
        okButtonProps={{ loading: deleteLoading }}
        destroyOnClose
      >
        <p>This action cannot be undone.</p>
      </Modal>
    </div>
  )
}
