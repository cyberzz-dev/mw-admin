import React, { useState, useEffect } from 'react'
import {
  Table, message, Space, Button, Tag, Input, Switch, Modal, Drawer, Typography,
} from 'antd'
import { EyeOutlined } from '@ant-design/icons'
import ClusterSelector from '../../components/ClusterSelector'
import { useResizableColumns, tableComponents } from '../../components/ResizableColumns'
import {
  listESClusters, listESTemplates,
  deleteESTemplate, bulkDeleteESTemplates, putESTemplate,
} from '../../services/api'

const { Text } = Typography

export default function ESTemplates() {
  const [clusterId, setClusterId] = useState<number | undefined>()
  const [templates, setTemplates] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [hideSystem, setHideSystem] = useState(true)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

  // View drawer (read-only)
  const [viewRecord, setViewRecord] = useState<any>(null)

  // Edit/Create modal
  const [editRecord, setEditRecord] = useState<any>(null) // null = create mode
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editJson, setEditJson] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  // Delete confirm modal
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const fetchTemplates = async () => {
    if (!clusterId) return
    setLoading(true)
    try {
      const res = await listESTemplates(clusterId)
      setTemplates(res.data || [])
      setSelectedRowKeys([])
      setSearch('')
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to fetch templates')
    }
    setLoading(false)
  }

  useEffect(() => { fetchTemplates() }, [clusterId])

  const displayData = templates.filter(t => {
    if (hideSystem && t.name?.startsWith('.')) return false
    if (search && !t.name?.toLowerCase().includes(search.toLowerCase())) return false
    return true
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
      setEditJson(typeof raw === 'string' ? raw : '')
    }
    setEditModalOpen(true)
  }

  const openCreate = () => {
    setEditRecord(null)
    setEditName('')
    setEditJson('{}')
    setEditModalOpen(true)
  }

  const handleSave = async () => {
    if (!clusterId) return
    const name = editRecord ? editRecord.name : editName.trim()
    if (!name) { message.error('Template name is required'); return }
    setEditSaving(true)
    try {
      const body = JSON.parse(editJson)
      await putESTemplate(clusterId, name, body)
      message.success(`Template "${name}" saved`)
      setEditModalOpen(false)
      fetchTemplates()
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
      await deleteESTemplate(clusterId, deleteTarget)
      message.success(`Deleted "${deleteTarget}"`)
      setDeleteTarget(null)
      fetchTemplates()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Delete failed')
    }
    setDeleteLoading(false)
  }

  const handleBulkDelete = () => {
    if (!clusterId || selectedRowKeys.length === 0) return
    Modal.confirm({
      title: `Delete ${selectedRowKeys.length} templates?`,
      content: 'This action cannot be undone.',
      okText: 'Delete',
      okType: 'danger',
      onOk: async () => {
        try {
          await bulkDeleteESTemplates(clusterId, selectedRowKeys as string[])
          message.success(`Deleted ${selectedRowKeys.length} templates`)
          fetchTemplates()
        } catch (e: any) {
          message.error(e.response?.data?.error || 'Bulk delete failed')
        }
      },
    })
  }

  const baseColumns = [
    {
      title: 'Template Name', dataIndex: 'name', width: 240,
      defaultSortOrder: 'ascend' as const,
      sorter: (a: any, b: any) => (a.name || '').localeCompare(b.name || ''),
    },
    {
      title: 'Index Patterns', dataIndex: 'index_patterns', width: 220,
      render: (v: string[]) => (v || []).map((p: string) => <Tag key={p} color="blue">{p}</Tag>),
    },
    {
      title: 'Composed Of', dataIndex: 'composed_of', width: 220,
      render: (v: string[]) =>
        (v || []).length === 0
          ? <Text type="secondary">-</Text>
          : (v || []).map((c: string) => <Tag key={c} color="purple">{c}</Tag>),
    },
    {
      title: 'Priority', dataIndex: 'priority', width: 80,
      sorter: (a: any, b: any) => (a.priority || 0) - (b.priority || 0),
    },
    {
      title: 'Version', dataIndex: 'version', width: 80,
      sorter: (a: any, b: any) => (a.version || 0) - (b.version || 0),
      render: (v: number) => v ?? <Text type="secondary">-</Text>,
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
          <h2 style={{ margin: 0 }}>Index Templates</h2>
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
            placeholder="Search template name"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: 260 }}
            allowClear
          />
          <Button onClick={fetchTemplates} disabled={!clusterId}>Refresh</Button>
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
        scroll={{ x: 1100 }}
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
        title={editRecord ? `Edit template: ${editRecord.name}` : 'Create template'}
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
            <label style={{ display: 'block', marginBottom: 4 }}>Template name</label>
            <Input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              placeholder="my-template"
              autoFocus
            />
          </div>
        )}
        <label style={{ display: 'block', marginBottom: 4 }}>Template JSON</label>
        <textarea
          value={editJson}
          onChange={e => setEditJson(e.target.value)}
          style={{ width: '100%', minHeight: 400, fontFamily: 'monospace', fontSize: 12, resize: 'vertical', padding: 8 }}
        />
      </Modal>

      {/* Delete confirmation modal */}
      <Modal
        title={`Delete template "${deleteTarget}"?`}
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
