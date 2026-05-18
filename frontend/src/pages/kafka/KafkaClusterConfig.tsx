import React, { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react'
import { Table, message, Space, Button, Input, Modal, Form, Tag, Select, Radio, Tabs, Switch, Badge, Tooltip } from 'antd'
import { EditOutlined, ReloadOutlined, RollbackOutlined, CheckCircleOutlined, WarningOutlined } from '@ant-design/icons'
import ClusterSelector from '../../components/ClusterSelector'
import { useResizableColumns, tableComponents } from '../../components/ResizableColumns'
import { useAuth } from '../../contexts/AuthContext'
import { listKafkaClusters, getClusterConfig, updateClusterConfig, listKafkaBrokers, getAllBrokersConfig } from '../../services/api'

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
  const [selectedBrokerId, setSelectedBrokerId] = useState<number | undefined>()
  const { hasPermission, isAdmin } = useAuth()

  // Comparison tab state
  const [activeTab, setActiveTab] = useState('single')
  const [compareSnapshots, setCompareSnapshots] = useState<any[]>([])
  const [compareLoading, setCompareLoading] = useState(false)
  const [diffOnly, setDiffOnly] = useState(false)
  const [compareSearch, setCompareSearch] = useState('')

  const canEdit = isAdmin || hasPermission('kafka_cluster_edit')

  const fetchConfig = async () => {
    if (!clusterId || selectedBrokerId === undefined) return
    setLoading(true)
    try {
      const res = await getClusterConfig(clusterId, selectedBrokerId)
      const data = res.data || []
      setConfigs(data)
      applySearch(data, search)
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to fetch config')
    }
    setLoading(false)
  }

  const fetchCompareData = async () => {
    if (!clusterId) return
    setCompareLoading(true)
    try {
      const res = await getAllBrokersConfig(clusterId)
      setCompareSnapshots(res.data || [])
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to fetch comparison data')
    }
    setCompareLoading(false)
  }

  const applySearch = (data: any[], q: string) => {
    setFiltered(!q ? data : data.filter((c: any) => c.name.includes(q) || (c.value || '').includes(q)))
  }

  useEffect(() => {
    setSelectedBrokerId(undefined)
    setConfigs([])
    setFiltered([])
    setBrokers([])
    setCompareSnapshots([])
    if (clusterId) {
      listKafkaBrokers(clusterId).then(res => setBrokers(res.data || [])).catch(() => {})
    }
  }, [clusterId])

  useEffect(() => {
    if (selectedBrokerId !== undefined) {
      fetchConfig()
    }
  }, [selectedBrokerId])

  useEffect(() => {
    if (activeTab === 'compare' && clusterId) {
      fetchCompareData()
    }
  }, [activeTab, clusterId])

  const handleSearch = (val: string) => {
    setSearch(val)
    applySearch(configs, val)
  }

  const openEdit = (record: any) => {
    setEditRecord(record)
    editForm.setFieldsValue({ value: record.value, scope: sourceInfo[record.source]?.scope ?? 'specific', broker_id: selectedBrokerId })
    setEditOpen(true)
  }

  const handleSave = async (resetToDefault = false) => {
    if (!resetToDefault) {
      try { await editForm.validateFields() } catch { return }
    }
    setSaving(true)
    try {
      const scope: string = editForm.getFieldValue('scope') ?? 'specific'
      const brokerId: number = scope === 'all' ? -1 : (editForm.getFieldValue('broker_id') ?? selectedBrokerId ?? -1)
      await updateClusterConfig(clusterId!, editRecord.name, resetToDefault ? null : editForm.getFieldValue('value'), brokerId)
      const target = brokerId === -1 ? 'all brokers (cluster-wide)' : `Broker ${brokerId} only`
      message.success(resetToDefault ? `Reset to default on ${target}` : `Config updated on ${target}`)
      setEditOpen(false)
      fetchConfig()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Update failed')
    }
    setSaving(false)
  }

  const sourceInfo: Record<string, { label: string; color: string; scope: 'specific' | 'all' }> = {
    broker:  { label: 'Broker-specific', color: 'blue',    scope: 'specific' },
    cluster: { label: 'Cluster-wide',    color: 'cyan',    scope: 'all' },
    static:  { label: 'Static',          color: 'default', scope: 'specific' },
    default: { label: 'Default',         color: 'default', scope: 'specific' },
  }

  // ---- Comparison tab derived data ----
  const compareRows = useMemo(() => {
    if (compareSnapshots.length === 0) return []
    const paramMap = new Map<string, { values: Record<string, string>; clusterWide: boolean; readOnly: boolean; sensitive: boolean }>()
    for (const snap of compareSnapshots) {
      for (const cfg of snap.configs as any[]) {
        if (!paramMap.has(cfg.name)) {
          paramMap.set(cfg.name, { values: {}, clusterWide: cfg.cluster_wide, readOnly: cfg.read_only, sensitive: cfg.sensitive })
        }
        paramMap.get(cfg.name)!.values[String(snap.broker_id)] = cfg.value
      }
    }
    const rows: any[] = []
    paramMap.forEach((meta, name) => {
      const vals = Object.values(meta.values)
      const consistent = vals.length > 0 && vals.every(v => v === vals[0])
      const freq: Record<string, number> = {}
      for (const v of vals) freq[v] = (freq[v] || 0) + 1
      const majorityVal = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
      rows.push({ key: name, name, ...meta, consistent, majorityVal })
    })
    return rows.sort((a, b) => a.name.localeCompare(b.name))
  }, [compareSnapshots])

  const diffCount = useMemo(() => compareRows.filter(r => !r.consistent).length, [compareRows])

  const filteredCompareRows = useMemo(() => {
    let rows = compareRows
    if (diffOnly) rows = rows.filter(r => !r.consistent)
    if (compareSearch) rows = rows.filter(r => r.name.includes(compareSearch))
    return rows
  }, [compareRows, diffOnly, compareSearch])

  const compareColumns = useMemo(() => {
    const cols: any[] = [
      {
        title: 'Parameter', dataIndex: 'name', width: 300, fixed: 'left' as const,
        defaultSortOrder: 'ascend' as const,
        sorter: (a: any, b: any) => a.name.localeCompare(b.name),
      },
      {
        title: 'Status', width: 120, fixed: 'left' as const,
        render: (_: any, r: any) => r.consistent
          ? <Tag color="success" icon={<CheckCircleOutlined />}>Consistent</Tag>
          : <Tag color="warning" icon={<WarningOutlined />}>Differs</Tag>,
      },
    ]
    for (const snap of compareSnapshots) {
      const bid = String(snap.broker_id)
      cols.push({
        title: (
          <div>
            <div>Broker {snap.broker_id}</div>
            <div style={{ fontSize: 11, fontWeight: 'normal', color: '#888' }}>{snap.host}</div>
          </div>
        ),
        width: 240,
        render: (_: any, r: any) => {
          if (r.sensitive) return <span style={{ color: '#bbb' }}>******</span>
          const v: string = r.values?.[bid]
          const isDiff = !r.consistent && v !== r.majorityVal
          return (
            <Tooltip title={isDiff ? `Majority: ${r.majorityVal}` : undefined}>
              <span style={isDiff ? { color: '#d46b08', fontWeight: 600 } : {}}>{v ?? <span style={{ color: '#ccc' }}>—</span>}</span>
            </Tooltip>
          )
        },
        onCell: (r: any) => ({
          style: (!r.consistent && r.values?.[bid] !== r.majorityVal) ? { backgroundColor: '#fff7e6' } : {},
        }),
      })
    }
    return cols
  }, [compareSnapshots])

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
      title: 'Source', width: 148,
      filters: [
        { text: 'Broker-specific', value: 'broker' },
        { text: 'Cluster-wide',    value: 'cluster' },
        { text: 'Static',          value: 'static' },
        { text: 'Default',         value: 'default' },
      ],
      onFilter: (value: any, r: any) => r.source === value,
      render: (_: any, r: any) => {
        const s = sourceInfo[r.source]
        return s ? <Tag color={s.color}>{s.label}</Tag> : null
      },
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
      if (top > 0) setTableScrollY(Math.max(200, window.innerHeight - top - 88))
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [clusterId, activeTab])

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
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        style={{ padding: '0 24px' }}
        items={[
          {
            key: 'single',
            label: 'Single Broker',
            children: (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Space>
                    <Select
                      style={{ width: 240 }}
                      placeholder="Select broker node"
                      value={selectedBrokerId}
                      onChange={setSelectedBrokerId}
                      disabled={!clusterId || brokers.length === 0}
                      allowClear
                    >
                      {brokers.map((b: any) => (
                        <Select.Option key={b.id} value={b.id}>
                          Broker {b.id} — {b.host}:{b.port}
                        </Select.Option>
                      ))}
                    </Select>
                  </Space>
                  <Space>
                    <Input.Search
                      placeholder="Search parameter name or value"
                      value={search}
                      onChange={e => handleSearch(e.target.value)}
                      style={{ width: 280 }}
                      allowClear
                    />
                    <Button icon={<ReloadOutlined />} onClick={fetchConfig} disabled={!clusterId || selectedBrokerId === undefined}>Refresh</Button>
                  </Space>
                </div>
                <div ref={tableRef}>
                  <Table
                    rowKey="name"
                    components={tableComponents}
                    columns={columns}
                    dataSource={filtered}
                    loading={loading}
                    locale={{ emptyText: selectedBrokerId === undefined ? (clusterId ? 'Please select a broker node above' : 'Please select a cluster first') : 'No config data' }}
                    size="small"
                    scroll={{ x: 'max-content', y: tableScrollY }}
                    pagination={{ defaultPageSize: 20, pageSizeOptions: ['20', '50', '100'], showSizeChanger: true, showTotal: (total) => `${total} items total`, size: 'small' }}
                  />
                </div>
              </div>
            ),
          },
          {
            key: 'compare',
            label: (
              <span>
                Broker Comparison
                {diffCount > 0 && (
                  <Badge count={diffCount} offset={[6, -2]} style={{ backgroundColor: '#fa8c16', fontSize: 11 }} />
                )}
              </span>
            ),
            children: (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Space>
                    <Switch size="small" checked={diffOnly} onChange={setDiffOnly} />
                    <span style={{ fontSize: 13 }}>Differences only</span>
                    {diffCount > 0 && <Tag color="orange">{diffCount} parameter{diffCount !== 1 ? 's' : ''} differ across brokers</Tag>}
                    {diffCount === 0 && compareSnapshots.length > 0 && <Tag color="success">All brokers consistent</Tag>}
                  </Space>
                  <Space>
                    <Input.Search
                      placeholder="Search parameter"
                      value={compareSearch}
                      onChange={e => setCompareSearch(e.target.value)}
                      style={{ width: 240 }}
                      allowClear
                    />
                    <Button icon={<ReloadOutlined />} onClick={fetchCompareData} disabled={!clusterId}>Refresh</Button>
                  </Space>
                </div>
                <Table
                  rowKey="key"
                  columns={compareColumns}
                  dataSource={filteredCompareRows}
                  loading={compareLoading}
                  locale={{ emptyText: clusterId ? 'No data — click Refresh' : 'Please select a cluster first' }}
                  size="small"
                  scroll={{ x: 'max-content', y: 'calc(100vh - 300px)' }}
                  onRow={(r: any) => ({ style: r.consistent ? {} : { backgroundColor: '#fffbe6' } })}
                  pagination={{ defaultPageSize: 20, pageSizeOptions: ['20', '50', '100'], showSizeChanger: true, showTotal: (total) => `${total} items`, size: 'small' }}
                />
              </div>
            ),
          },
        ]}
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
          <Form.Item name="scope" label="Apply to">
            <Radio.Group buttonStyle="solid">
              <Radio.Button value="specific">Broker-only</Radio.Button>
              <Radio.Button value="all" disabled={!editRecord?.cluster_wide}>
                Cluster-wide (All Brokers){!editRecord?.cluster_wide ? ' — not supported' : ''}
              </Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, curr) => prev.scope !== curr.scope}>
            {({ getFieldValue }) =>
              getFieldValue('scope') === 'all' ? (
                <div style={{ marginBottom: 16, padding: '8px 12px', background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 6, fontSize: 12, color: '#614700' }}>
                  The change will be applied to <strong>all {brokers.length} broker{brokers.length !== 1 ? 's' : ''}</strong> in the cluster.
                </div>
              ) : (
                <Form.Item name="broker_id" label="Target Broker" rules={[{ required: true, message: 'Please select a broker' }]}>
                  <Select placeholder="Select broker">
                    {brokers.map((b: any) => (
                      <Select.Option key={b.id} value={b.id}>Broker {b.id} — {b.host}:{b.port}</Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              )
            }
          </Form.Item>
          <Form.Item name="value" label="Value" rules={[{ required: true, message: 'Value is required' }]}>
            <Input />
          </Form.Item>
          <div style={{ color: '#888', fontSize: 12 }}>
            Dynamic config — no broker restart required.
          </div>
        </Form>
      </Modal>
    </div>
  )
}
