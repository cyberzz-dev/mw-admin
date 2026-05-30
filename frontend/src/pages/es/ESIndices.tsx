import React, { useState, useEffect } from 'react'
import {
  Table, message, Space, Button, Tag, Input, Switch, Modal, Drawer, Popconfirm,
} from 'antd'
import ClusterSelector from '../../components/ClusterSelector'
import { useResizableColumns, tableComponents } from '../../components/ResizableColumns'
import {
  listESClusters, listESIndices,
  deleteESIndex, bulkDeleteESIndices,
  closeESIndex, openESIndex, bulkCloseESIndices,
  getESIndexMapping, putESIndexMapping,
  getESIndexSettings, putESIndexSettings,
} from '../../services/api'

const healthColor: Record<string, string> = { green: 'green', yellow: 'gold', red: 'red' }

const parseSizeToBytes = (sizeStr: string): number => {
  if (!sizeStr) return 0
  const s = sizeStr.toLowerCase().trim()
  const num = parseFloat(s)
  if (isNaN(num)) return 0
  if (s.endsWith('tb')) return num * 1024 ** 4
  if (s.endsWith('gb')) return num * 1024 ** 3
  if (s.endsWith('mb')) return num * 1024 ** 2
  if (s.endsWith('kb')) return num * 1024
  return num
}

export default function ESIndices({ fixedClusterId }: { fixedClusterId?: number } = {}) {
  const [clusterId, setClusterId] = useState<number | undefined>(fixedClusterId)
  const [indices, setIndices] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [hideSystem, setHideSystem] = useState(true)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

  // Delete confirm modal
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)

  // Close confirm modal
  const [closeTarget, setCloseTarget] = useState<string | null>(null)
  const [closeLoading, setCloseLoading] = useState(false)

  // Open confirm modal
  const [openTarget, setOpenTarget] = useState<string | null>(null)
  const [openLoading, setOpenLoading] = useState(false)

  // Mapping drawer
  const [mappingIndex, setMappingIndex] = useState<string | null>(null)
  const [mappingJson, setMappingJson] = useState('')
  const [mappingLoading, setMappingLoading] = useState(false)
  const [mappingSaving, setMappingSaving] = useState(false)

  // Settings drawer
  const [settingsIndex, setSettingsIndex] = useState<string | null>(null)
  const [settingsJson, setSettingsJson] = useState('')
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)

  const fetchIndices = async () => {
    if (!clusterId) return
    setLoading(true)
    try {
      const res = await listESIndices(clusterId)
      setIndices(res.data || [])
      setSelectedRowKeys([])
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to fetch indices')
    }
    setLoading(false)
  }

  useEffect(() => { fetchIndices() }, [clusterId])

  const displayData = indices.filter(i => {
    if (hideSystem && i.index?.startsWith('.')) return false
    if (search && !i.index?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // ---- Delete ----
  const openDeleteModal = (indexName: string) => {
    setDeleteTarget(indexName)
    setDeleteConfirmInput('')
  }

  const handleDelete = async () => {
    if (!clusterId || !deleteTarget) return
    setDeleteLoading(true)
    try {
      await deleteESIndex(clusterId, deleteTarget)
      message.success(`Deleted ${deleteTarget}`)
      setDeleteTarget(null)
      fetchIndices()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Delete failed')
    }
    setDeleteLoading(false)
  }

  const handleBulkDelete = async () => {
    if (!clusterId || selectedRowKeys.length === 0) return
    Modal.confirm({
      title: `Delete ${selectedRowKeys.length} indices?`,
      content: 'This action cannot be undone.',
      okText: 'Delete',
      okType: 'danger',
      onOk: async () => {
        try {
          await bulkDeleteESIndices(clusterId, selectedRowKeys as string[])
          message.success(`Deleted ${selectedRowKeys.length} indices`)
          fetchIndices()
        } catch (e: any) {
          message.error(e.response?.data?.error || 'Bulk delete failed')
        }
      },
    })
  }

  // ---- Close ----
  const handleClose = async () => {
    if (!clusterId || !closeTarget) return
    setCloseLoading(true)
    try {
      await closeESIndex(clusterId, closeTarget)
      message.success(`Closed ${closeTarget}`)
      setCloseTarget(null)
      fetchIndices()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Close failed')
    }
    setCloseLoading(false)
  }

  // ---- Open ----
  const handleOpen = async () => {
    if (!clusterId || !openTarget) return
    setOpenLoading(true)
    try {
      await openESIndex(clusterId, openTarget)
      message.success(`Opened ${openTarget}`)
      setOpenTarget(null)
      fetchIndices()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Open failed')
    }
    setOpenLoading(false)
  }

  const handleBulkClose = async () => {
    if (!clusterId || selectedRowKeys.length === 0) return
    Modal.confirm({
      title: `Close ${selectedRowKeys.length} indices?`,
      content: 'Closed indices cannot be searched.',
      okText: 'Close',
      okType: 'danger',
      onOk: async () => {
        try {
          await bulkCloseESIndices(clusterId, selectedRowKeys as string[])
          message.success(`Closed ${selectedRowKeys.length} indices`)
          fetchIndices()
        } catch (e: any) {
          message.error(e.response?.data?.error || 'Bulk close failed')
        }
      },
    })
  }

  // ---- Mapping ----
  const openMappingDrawer = async (indexName: string) => {
    setMappingIndex(indexName)
    setMappingJson('')
    setMappingLoading(true)
    try {
      const res = await getESIndexMapping(clusterId!, indexName)
      setMappingJson(JSON.stringify(res.data, null, 2))
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to load mapping')
    }
    setMappingLoading(false)
  }

  const saveMapping = async () => {
    if (!clusterId || !mappingIndex) return
    setMappingSaving(true)
    try {
      const body = JSON.parse(mappingJson)
      await putESIndexMapping(clusterId, mappingIndex, body)
      message.success('Mapping saved')
      setMappingIndex(null)
    } catch (e: any) {
      message.error(e.response?.data?.error || e.message || 'Save failed')
    }
    setMappingSaving(false)
  }

  // ---- Settings ----
  const openSettingsDrawer = async (indexName: string) => {
    setSettingsIndex(indexName)
    setSettingsJson('')
    setSettingsLoading(true)
    try {
      const res = await getESIndexSettings(clusterId!, indexName)
      setSettingsJson(JSON.stringify(res.data, null, 2))
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to load settings')
    }
    setSettingsLoading(false)
  }

  const saveSettings = async () => {
    if (!clusterId || !settingsIndex) return
    setSettingsSaving(true)
    try {
      const body = JSON.parse(settingsJson)
      await putESIndexSettings(clusterId, settingsIndex, body)
      message.success('Settings saved')
      setSettingsIndex(null)
    } catch (e: any) {
      message.error(e.response?.data?.error || e.message || 'Save failed')
    }
    setSettingsSaving(false)
  }

  const baseColumns = [
    {
      title: 'Health', dataIndex: 'health', width: 90,
      sorter: (a: any, b: any) => (a.health || '').localeCompare(b.health || ''),
      render: (v: string) => <Tag color={healthColor[v] || 'default'}>{v}</Tag>,
    },
    {
      title: 'Status', dataIndex: 'status', width: 80,
      sorter: (a: any, b: any) => (a.status || '').localeCompare(b.status || ''),
      render: (v: string) => <Tag color={v === 'open' ? 'blue' : 'orange'}>{v}</Tag>,
    },
    {
      title: 'Index Name', dataIndex: 'index', width: 240,
      defaultSortOrder: 'ascend' as const,
      sorter: (a: any, b: any) => (a.index || '').localeCompare(b.index || ''),
    },
    { title: 'Pri', dataIndex: 'pri', width: 60, sorter: (a: any, b: any) => parseInt(a.pri || '0') - parseInt(b.pri || '0') },
    { title: 'Rep', dataIndex: 'rep', width: 60, sorter: (a: any, b: any) => parseInt(a.rep || '0') - parseInt(b.rep || '0') },
    { title: 'Docs', dataIndex: 'docs.count', width: 90, sorter: (a: any, b: any) => parseInt(a['docs.count'] || '0') - parseInt(b['docs.count'] || '0') },
    { title: 'Size', dataIndex: 'store.size', width: 90, sorter: (a: any, b: any) => parseSizeToBytes(a['store.size']) - parseSizeToBytes(b['store.size']) },
    {
      title: 'Actions', width: 260, fixed: 'right' as const,
      render: (_: any, record: any) => (
        <Space size={4}>
          <Button size="small" onClick={() => openMappingDrawer(record.index)}>Mapping</Button>
          <Button size="small" onClick={() => openSettingsDrawer(record.index)}>Settings</Button>
          {record.status === 'close'
            ? <Button size="small" onClick={() => setOpenTarget(record.index)}>Open</Button>
            : <Button size="small" danger onClick={() => setCloseTarget(record.index)}>Close</Button>
          }
          <Button size="small" danger onClick={() => openDeleteModal(record.index)}>Delete</Button>
        </Space>
      ),
    },
  ]
  const columns = useResizableColumns(baseColumns)

  return (
    <div>
      <div className="page-header">
        {!fixedClusterId && (
          <Space>
            <h2 style={{ margin: 0 }}>Indices</h2>
            <ClusterSelector
              value={clusterId}
              onChange={setClusterId}
              fetchClusters={listESClusters}
              placeholder="Select ES cluster"
            />
          </Space>
        )}
        <Space>
          <Switch
            checked={hideSystem}
            onChange={setHideSystem}
            checkedChildren="Hide system"
            unCheckedChildren="Show system"
          />
          {selectedRowKeys.length > 0 && (
            <>
              <Button danger onClick={handleBulkClose}>Close ({selectedRowKeys.length})</Button>
              <Button danger onClick={handleBulkDelete}>Delete ({selectedRowKeys.length})</Button>
            </>
          )}
          <Input.Search
            placeholder="Search index name"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: 260 }}
            allowClear
          />
          <Button onClick={fetchIndices} disabled={!clusterId}>Refresh</Button>
        </Space>
      </div>

      <Table
        rowKey="index"
        rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
        components={tableComponents}
        columns={columns}
        dataSource={displayData}
        loading={loading}
        size="small"
        tableLayout="fixed"
        scroll={{ x: 1050 }}
      />

      {/* Delete confirmation modal */}
      <Modal
        title={`Delete index "${deleteTarget}"?`}
        open={!!deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onOk={handleDelete}
        okText="Delete"
        okType="danger"
        okButtonProps={{ disabled: deleteConfirmInput !== deleteTarget, loading: deleteLoading }}
        destroyOnClose
      >
        <p>Type the index name to confirm:</p>
        <Input
          value={deleteConfirmInput}
          onChange={e => setDeleteConfirmInput(e.target.value)}
          placeholder={deleteTarget ?? ''}
          autoFocus
        />
      </Modal>

      {/* Close confirmation modal */}
      <Modal
        title={`Close index "${closeTarget}"?`}
        open={!!closeTarget}
        onCancel={() => setCloseTarget(null)}
        onOk={handleClose}
        okText="Close Index"
        okType="danger"
        okButtonProps={{ loading: closeLoading }}
        destroyOnClose
      >
        <p>The index will be closed and cannot be searched until reopened.</p>
      </Modal>

      {/* Open confirmation modal */}
      <Modal
        title={`Open index "${openTarget}"?`}
        open={!!openTarget}
        onCancel={() => setOpenTarget(null)}
        onOk={handleOpen}
        okText="Open Index"
        okButtonProps={{ loading: openLoading }}
        destroyOnClose
      >
        <p>The index will be reopened and become searchable again.</p>
      </Modal>

      {/* Mapping drawer */}
      <Drawer
        title={`Mapping: ${mappingIndex}`}
        open={!!mappingIndex}
        onClose={() => setMappingIndex(null)}
        width={720}
        styles={{ body: { display: 'flex', flexDirection: 'column', gap: 12, padding: 16 } }}
        extra={
          <Button type="primary" onClick={saveMapping} loading={mappingSaving}>Save</Button>
        }
      >
        {mappingLoading
          ? <p>Loading…</p>
          : (
            <textarea
              value={mappingJson}
              onChange={e => setMappingJson(e.target.value)}
              style={{ flex: 1, minHeight: 500, fontFamily: 'monospace', fontSize: 12, resize: 'vertical', padding: 8 }}
            />
          )}
      </Drawer>

      {/* Settings drawer */}
      <Drawer
        title={`Settings: ${settingsIndex}`}
        open={!!settingsIndex}
        onClose={() => setSettingsIndex(null)}
        width={720}
        styles={{ body: { display: 'flex', flexDirection: 'column', gap: 12, padding: 16 } }}
        extra={
          <Button type="primary" onClick={saveSettings} loading={settingsSaving}>Save</Button>
        }
      >
        {settingsLoading
          ? <p>Loading…</p>
          : (
            <textarea
              value={settingsJson}
              onChange={e => setSettingsJson(e.target.value)}
              style={{ flex: 1, minHeight: 500, fontFamily: 'monospace', fontSize: 12, resize: 'vertical', padding: 8 }}
            />
          )}
      </Drawer>
    </div>
  )
}
