import React, { useState, useEffect } from 'react'
import { Table, message, Space, Button, Input, Modal, Form, Tag, Select } from 'antd'
import { EditOutlined, ReloadOutlined, RollbackOutlined } from '@ant-design/icons'
import ClusterSelector from '../../components/ClusterSelector'
import { useResizableColumns, tableComponents } from '../../components/ResizableColumns'
import { useAuth } from '../../contexts/AuthContext'
import { listKafkaClusters, listTopics, getTopicConfig, updateTopicConfig } from '../../services/api'

interface Props {
  embedded?: boolean
  fixedClusterId?: number
  fixedTopicName?: string
}

export default function KafkaTopicConfig({ embedded, fixedClusterId, fixedTopicName }: Props = {}) {
  const [clusterId, setClusterId] = useState<number | undefined>(fixedClusterId)
  const [topics, setTopics] = useState<any[]>([])
  const [topicName, setTopicName] = useState<string | undefined>(fixedTopicName)
  const [configs, setConfigs] = useState<any[]>([])
  const [filtered, setFiltered] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [topicsLoading, setTopicsLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [editRecord, setEditRecord] = useState<any>(null)
  const [editForm] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const { hasPermission, isAdmin } = useAuth()

  const canEdit = isAdmin || hasPermission('kafka_topic_edit')

  const fetchTopics = async (cid: number) => {
    setTopicsLoading(true)
    try {
      const res = await listTopics(cid)
      setTopics(res.data || [])
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to fetch topics')
    }
    setTopicsLoading(false)
  }

  const fetchConfig = async (cid?: number, topic?: string) => {
    const effectiveClusterId = cid ?? clusterId
    const effectiveTopic = topic ?? topicName
    if (!effectiveClusterId || !effectiveTopic) return
    setLoading(true)
    try {
      const res = await getTopicConfig(effectiveClusterId, effectiveTopic)
      const data = res.data || []
      setConfigs(data)
      applySearch(data, search)
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to fetch config')
    }
    setLoading(false)
  }

  const applySearch = (data: any[], q: string) => {
    setFiltered(!q ? data : data.filter((c: any) => c.name.includes(q) || (c.value || '').includes(q)))
  }

  useEffect(() => {
    if (embedded) return
    setTopicName(undefined)
    setTopics([])
    setConfigs([])
    setFiltered([])
    setSearch('')
    if (clusterId) fetchTopics(clusterId)
  }, [clusterId])

  useEffect(() => {
    if (embedded) return
    setConfigs([])
    setFiltered([])
    setSearch('')
    if (topicName) fetchConfig()
  }, [topicName])

  // Embedded mode: sync with parent-provided cluster/topic and auto-load
  useEffect(() => {
    if (!embedded) return
    setClusterId(fixedClusterId)
    setTopicName(fixedTopicName)
    setSearch('')
    if (fixedClusterId && fixedTopicName) fetchConfig(fixedClusterId, fixedTopicName)
  }, [embedded, fixedClusterId, fixedTopicName])

  const handleSearch = (val: string) => {
    setSearch(val)
    applySearch(configs, val)
  }

  const openEdit = (record: any) => {
    setEditRecord(record)
    editForm.setFieldsValue({ value: record.value })
    setEditOpen(true)
  }

  const handleSave = async (resetToDefault = false) => {
    if (!resetToDefault) {
      try { await editForm.validateFields() } catch { return }
    }
    setSaving(true)
    try {
      await updateTopicConfig(clusterId!, topicName!, editRecord.name, resetToDefault ? null : editForm.getFieldValue('value'))
      message.success(resetToDefault ? 'Reset to default' : 'Config updated')
      setEditOpen(false)
      fetchConfig()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Update failed')
    }
    setSaving(false)
  }

  const baseColumns = [
    {
      title: 'Parameter', dataIndex: 'name', width: 300,
      defaultSortOrder: 'ascend' as const,
      sorter: (a: any, b: any) => (a.name || '').localeCompare(b.name || ''),
    },
    {
      title: 'Value', dataIndex: 'value', width: 260,
      sorter: (a: any, b: any) => (a.value || '').localeCompare(b.value || ''),
      render: (v: string, r: any) => r.sensitive ? <span style={{ color: '#999' }}>******</span> : (v ?? '-'),
    },
    {
      title: 'Status', width: 110,
      render: (_: any, r: any) => r.is_default
        ? <Tag color="default">Default</Tag>
        : <Tag color="blue">Custom</Tag>,
    },
    {
      title: 'Actions', width: 90,
      render: (_: any, record: any) =>
        canEdit && !record.read_only && !record.sensitive ? (
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>Edit</Button>
        ) : null,
    },
  ]
  const columns = useResizableColumns(baseColumns)

  return (
    <div>
      {!embedded ? (
        <div className="page-header">
          <Space wrap>
            <h2 style={{ margin: 0 }}>Topic Configuration</h2>
            <ClusterSelector
              value={clusterId}
              onChange={setClusterId}
              fetchClusters={listKafkaClusters}
              placeholder="Select Kafka cluster"
            />
            <Select
              value={topicName}
              onChange={v => setTopicName(v)}
              placeholder="Select topic"
              style={{ width: 240 }}
              loading={topicsLoading}
              disabled={!clusterId}
              showSearch
              allowClear
              filterOption={(input, option) =>
                (option?.value as string || '').toLowerCase().includes(input.toLowerCase())
              }
              options={topics.map((t: any) => ({ value: t.name, label: t.name }))}
            />
          </Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => fetchConfig()}
            disabled={!clusterId || !topicName}
          >
            Refresh
          </Button>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => fetchConfig()} loading={loading}>Refresh</Button>
        </div>
      )}
      <Input.Search
        placeholder="Search parameter name or value"
        value={search}
        onChange={e => handleSearch(e.target.value)}
        style={{ marginBottom: 16, maxWidth: 400 }}
        allowClear
        disabled={!topicName}
      />
      <Table
        rowKey="name"
        components={tableComponents}
        columns={columns}
        dataSource={filtered}
        loading={loading}
        size="small"
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: topicName ? 'No config data' : 'Please select a topic first' }}
        pagination={{ defaultPageSize: 20, pageSizeOptions: ['20', '50', '100'], showSizeChanger: true, showTotal: (total) => `${total} items total`, size: 'small' }}
      />

      <Modal
        title={`Edit Config — ${editRecord?.name}`}
        open={editOpen}
        onCancel={() => { setEditOpen(false); editForm.resetFields() }}
        destroyOnClose
        footer={[
          <Button key="cancel" onClick={() => { setEditOpen(false); editForm.resetFields() }}>Cancel</Button>,
          <Button
            key="reset"
            icon={<RollbackOutlined />}
            onClick={() => handleSave(true)}
            loading={saving}
            disabled={editRecord?.is_default}
          >
            Reset to Default
          </Button>,
          <Button key="ok" type="primary" onClick={() => handleSave(false)} loading={saving}>Save</Button>,
        ]}
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="value" label="Value" rules={[{ required: true, message: 'Value is required' }]}>
            <Input autoFocus />
          </Form.Item>
          <div style={{ color: '#888', fontSize: 12 }}>
            Changes take effect immediately. This is a dynamic config and requires no restart.
          </div>
        </Form>
      </Modal>
    </div>
  )
}
