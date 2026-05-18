import React, { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { Table, message, Space, Button, Input, Modal, Form, Tag, Select } from 'antd'
import { EditOutlined, ReloadOutlined, RollbackOutlined } from '@ant-design/icons'
import ClusterSelector from '../../components/ClusterSelector'
import { useResizableColumns, tableComponents } from '../../components/ResizableColumns'
import { useAuth } from '../../contexts/AuthContext'
import { listKafkaClusters, getClusterConfig, updateClusterConfig, listKafkaBrokers } from '../../services/api'

export default function KafkaClusterConfig() {
  const [clusterId, setClusterId] = useState<number | undefined>()
  const [configs, setConfigs] = useState<any[]>([])
  const [filtered, setFiltered] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [editRecord, setEditRecord] = useState<any>(null)
  const [editForm] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [brokers, setBrokers] = useState<any[]>([])
  const { hasPermission, isAdmin } = useAuth()

  const canEdit = isAdmin || hasPermission('kafka_cluster_edit')

  const fetchConfig = async () => {
    if (!clusterId) return
    setLoading(true)
    try {
      const res = await getClusterConfig(clusterId)
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
    fetchConfig()
    setBrokers([])
    if (clusterId) {
      listKafkaBrokers(clusterId).then(res => setBrokers(res.data || [])).catch(() => {})
    }
  }, [clusterId])

  const handleSearch = (val: string) => {
    setSearch(val)
    applySearch(configs, val)
  }

  const openEdit = (record: any) => {
    setEditRecord(record)
    editForm.setFieldsValue({ value: record.value, broker_id: -1 })
    setEditOpen(true)
  }

  const handleSave = async (resetToDefault = false) => {
    if (!resetToDefault) {
      try { await editForm.validateFields() } catch { return }
    }
    setSaving(true)
    try {
      const brokerId: number = editForm.getFieldValue('broker_id') ?? -1
      await updateClusterConfig(clusterId!, editRecord.name, resetToDefault ? null : editForm.getFieldValue('value'), brokerId)
      const target = brokerId === -1 ? 'All Brokers' : `Broker ${brokerId}`
      message.success(resetToDefault ? `Reset to default on ${target}` : `Config updated on ${target}`)
      setEditOpen(false)
      fetchConfig()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Update failed')
    }
    setSaving(false)
  }

  const baseColumns = [
    {
      title: 'Parameter', dataIndex: 'name', width: 320,
      defaultSortOrder: 'ascend' as const,
      sorter: (a: any, b: any) => (a.name || '').localeCompare(b.name || ''),
    },
    {
      title: 'Value', dataIndex: 'value', width: 280,
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

  const tableRef = useRef<HTMLDivElement>(null)
  const [tableScrollY, setTableScrollY] = useState(500)
  useLayoutEffect(() => {
    const compute = () => {
      if (!tableRef.current) return
      const top = tableRef.current.getBoundingClientRect().top
      setTableScrollY(Math.max(200, window.innerHeight - top - 88))
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [clusterId])

  return (
    <div>
      <div className="page-header">
        <Space>
          <h2 style={{ margin: 0 }}>Cluster Configuration</h2>
          <ClusterSelector
            value={clusterId}
            onChange={setClusterId}
            fetchClusters={listKafkaClusters}
            placeholder="Select Kafka cluster"
          />
        </Space>
        <Space>
          <Input.Search
            placeholder="Search parameter name or value"
            value={search}
            onChange={e => handleSearch(e.target.value)}
            style={{ width: 280 }}
            allowClear
          />
          <Button icon={<ReloadOutlined />} onClick={fetchConfig} disabled={!clusterId}>Refresh</Button>
        </Space>
      </div>
      <div ref={tableRef}>
      <Table
        rowKey="name"
        components={tableComponents}
        columns={columns}
        dataSource={filtered}
        loading={loading}
        size="small"
        scroll={{ x: 'max-content', y: tableScrollY }}
        pagination={{ defaultPageSize: 20, pageSizeOptions: ['20', '50', '100'], showSizeChanger: true, showTotal: (total) => `${total} items total`, size: 'small' }}
      />
      </div>

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
          <Form.Item name="broker_id" label="Apply to">
            <Select>
              <Select.Option value={-1}>All Brokers (cluster-wide)</Select.Option>
              {brokers.map((b: any) => (
                <Select.Option key={b.id} value={b.id}>Broker {b.id} — {b.host}:{b.port}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="value" label="Value" rules={[{ required: true, message: 'Value is required' }]}>
            <Input />
          </Form.Item>
          <div style={{ color: '#888', fontSize: 12 }}>
            When "All Brokers" is selected, the config will be applied to every node in the cluster. This is a dynamic config and requires no restart.
          </div>
        </Form>
      </Modal>
    </div>
  )
}
