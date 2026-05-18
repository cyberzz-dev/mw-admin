import React, { useState, useCallback, useEffect } from 'react'
import {
  Tree, Spin, Button, Space, Table, Tag, Modal,
  Form, Input, Select, message, Tooltip, Empty, Checkbox, Row, Col, Badge,
} from 'antd'
import {
  ReloadOutlined, PlusOutlined, DeleteOutlined, EditOutlined, SaveOutlined, MinusCircleOutlined,
  FolderOutlined, FolderOpenOutlined, SearchOutlined, CaretRightFilled,
} from '@ant-design/icons'
import type { DataNode } from 'antd/es/tree'
import {
  listZKClusters, listZKChildren, getZKNode,
  createZKNode, setZKNodeData, deleteZKNode, setZKACL, getZKStats,
} from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'

const PAGE_SIZE = 200

// ---- Types ----
interface ZKTreeNode extends DataNode {
  isLoadMore?: boolean
  parentPath?: string
  nextOffset?: number
  remaining?: number
}

interface NodeInfo {
  path: string
  data: string
  is_json: boolean
  stat: {
    czxid: number; mzxid: number; ctime: number; mtime: number
    version: number; cversion: number; aversion: number
    ephemeral_owner: number; data_length: number; num_children: number; pzxid: number
  }
  acls: Array<{ scheme: string; id: string; perms: number; perms_str: string }>
}

// ---- Helpers ----
function buildPath(parentPath: string, childName: string): string {
  if (parentPath === '/') return '/' + childName
  return parentPath + '/' + childName
}

function updateTreeNode(list: ZKTreeNode[], key: string, children: ZKTreeNode[]): ZKTreeNode[] {
  return list.map(node => {
    if (String(node.key) === key) {
      return { ...node, children }
    }
    if (node.children) {
      return { ...node, children: updateTreeNode(node.children as ZKTreeNode[], key, children) }
    }
    return node
  })
}

function formatTime(ms: number): string {
  if (!ms) return '-'
  return new Date(ms).toLocaleString()
}

function permsToCheckboxValue(perms: number): string[] {
  const result: string[] = []
  if (perms & 1) result.push('r')
  if (perms & 2) result.push('w')
  if (perms & 4) result.push('c')
  if (perms & 8) result.push('d')
  if (perms & 16) result.push('a')
  return result
}

function checkboxToPerms(checked: string[]): number {
  let perms = 0
  if (checked.includes('r')) perms |= 1
  if (checked.includes('w')) perms |= 2
  if (checked.includes('c')) perms |= 4
  if (checked.includes('d')) perms |= 8
  if (checked.includes('a')) perms |= 16
  return perms
}

// ---- ACL Edit Modal ----
interface ACLEntry { scheme: string; id: string; perms: string[] }
function ACLEditModal({ open, acls, version, onCancel, onSave }: {
  open: boolean; acls: NodeInfo['acls']; version: number
  onCancel: () => void; onSave: (acls: ACLEntry[], version: number) => void
}) {
  const [entries, setEntries] = useState<ACLEntry[]>([])
  useEffect(() => {
    if (open) setEntries(acls.map(a => ({ scheme: a.scheme, id: a.id, perms: permsToCheckboxValue(a.perms) })))
  }, [open, acls])

  const addRow = () => setEntries(prev => [...prev, { scheme: 'world', id: 'anyone', perms: ['r'] }])
  const removeRow = (i: number) => setEntries(prev => prev.filter((_, idx) => idx !== i))
  const updateRow = (i: number, field: keyof ACLEntry, val: any) =>
    setEntries(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: val } : e))

  return (
    <Modal title="Edit ACL" open={open} onCancel={onCancel} width={640}
      onOk={() => onSave(entries, version)} okText="Save">
      <div style={{ marginBottom: 12 }}>
        {entries.map((entry, i) => (
          <Row key={i} gutter={8} style={{ marginBottom: 8, alignItems: 'center' }}>
            <Col span={5}>
              <Select value={entry.scheme} onChange={v => updateRow(i, 'scheme', v)} style={{ width: '100%' }}>
                <Select.Option value="world">world</Select.Option>
                <Select.Option value="auth">auth</Select.Option>
                <Select.Option value="digest">digest</Select.Option>
                <Select.Option value="host">host</Select.Option>
                <Select.Option value="ip">ip</Select.Option>
              </Select>
            </Col>
            <Col span={7}>
              <Input value={entry.id} onChange={e => updateRow(i, 'id', e.target.value)} placeholder="ID" />
            </Col>
            <Col span={9}>
              <Checkbox.Group value={entry.perms} onChange={v => updateRow(i, 'perms', v)}>
                {['r', 'w', 'c', 'd', 'a'].map(p => (
                  <Checkbox key={p} value={p}>{p.toUpperCase()}</Checkbox>
                ))}
              </Checkbox.Group>
            </Col>
            <Col span={3}>
              <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => removeRow(i)} />
            </Col>
          </Row>
        ))}
        <Button type="dashed" icon={<PlusOutlined />} onClick={addRow}>Add Entry</Button>
      </div>
    </Modal>
  )
}

// ---- Main Component ----
export default function ZKNodes() {
  const { hasPermission } = useAuth()
  const canEdit = hasPermission('zk_node_edit')
  const canDelete = hasPermission('zk_node_delete')

  const [clusters, setClusters] = useState<any[]>([])
  const [clusterId, setClusterId] = useState<number | null>(null)
  const [treeData, setTreeData] = useState<ZKTreeNode[]>([])
  const [loadingTree, setLoadingTree] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [nodeInfo, setNodeInfo] = useState<NodeInfo | null>(null)
  const [loadingNode, setLoadingNode] = useState(false)
  const [expandedKeys, setExpandedKeys] = useState<string[]>([])

  // Edit Data modal
  const [editDataOpen, setEditDataOpen] = useState(false)
  const [editDataValue, setEditDataValue] = useState('')

  // Add Child modal
  const [addChildOpen, setAddChildOpen] = useState(false)
  const [addChildForm] = Form.useForm()

  // Edit ACL modal
  const [editACLOpen, setEditACLOpen] = useState(false)

  // Delete confirm modal
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteInput, setDeleteInput] = useState('')
  const [deleteRecursiveAck, setDeleteRecursiveAck] = useState(false)

  // Tree search
  const [treeSearch, setTreeSearch] = useState('')

  // Server stats
  const [clusterStats, setClusterStats] = useState<{ watch_count: number; znode_count: number; connections: number } | null>(null)

  // Load clusters
  useEffect(() => {
    listZKClusters().then(res => {
      const list = res.data || []
      setClusters(list)
    }).catch(() => {})
  }, [])

  // Load root and stats when cluster changes
  useEffect(() => {
    if (!clusterId) return
    loadRoot()
    setClusterStats(null)
    getZKStats(clusterId)
      .then(res => setClusterStats(res.data))
      .catch(() => {})
  }, [clusterId])

  const loadRoot = async () => {
    if (!clusterId) return
    setLoadingTree(true)
    setTreeData([])
    setSelectedPath(null)
    setNodeInfo(null)
    setExpandedKeys([])
    try {
      const res = await listZKChildren(clusterId, '/', 0, PAGE_SIZE)
      const { children, total } = res.data
      const nodes = buildChildNodes('/', children, 0, total)
      setTreeData([{
        key: '/',
        title: '/',
        children: nodes,
        isLeaf: false,
      }])
      setExpandedKeys(['/'])
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to load ZooKeeper tree')
    } finally {
      setLoadingTree(false)
    }
  }

  function buildChildNodes(parentPath: string, children: string[], offset: number, total: number): ZKTreeNode[] {
    const nodes: ZKTreeNode[] = children.map(name => ({
      key: buildPath(parentPath, name),
      title: name,
      isLeaf: false,
    }))
    const loaded = offset + children.length
    if (loaded < total) {
      nodes.push({
        key: `__more__${parentPath}__${loaded}`,
        title: `... Load more (${total - loaded} remaining)`,
        isLeaf: true,
        isLoadMore: true,
        parentPath,
        nextOffset: loaded,
        remaining: total - loaded,
      })
    }
    return nodes
  }

  const onLoadData = useCallback(async (node: any): Promise<void> => {
    if (!clusterId) return
    const path = String(node.key)
    if (path.startsWith('__more__')) return

    // Already loaded children
    if (node.children && node.children.length > 0) return

    const res = await listZKChildren(clusterId, path, 0, PAGE_SIZE)
    const { children, total } = res.data
    const childNodes = buildChildNodes(path, children, 0, total)
    setTreeData(prev => updateTreeNode(prev, path, childNodes))
  }, [clusterId])

  const handleLoadMore = async (node: ZKTreeNode) => {
    if (!clusterId || !node.parentPath) return
    const { parentPath, nextOffset = 0 } = node
    try {
      const res = await listZKChildren(clusterId, parentPath, nextOffset, PAGE_SIZE)
      const { children, total } = res.data
      const newNodes = buildChildNodes(parentPath, children, nextOffset, total)

      setTreeData(prev => {
        // Remove the load-more pseudo-node and append new real nodes
        function patch(list: ZKTreeNode[]): ZKTreeNode[] {
          return list.map(item => {
            if (String(item.key) === parentPath) {
              const filtered = (item.children as ZKTreeNode[] || []).filter(c => !c.isLoadMore)
              return { ...item, children: [...filtered, ...newNodes] }
            }
            if (item.children) return { ...item, children: patch(item.children as ZKTreeNode[]) }
            return item
          })
        }
        return patch(prev)
      })
    } catch (e: any) {
      message.error('Failed to load more nodes')
    }
  }

  const fetchNodeInfo = async (path: string) => {
    if (!clusterId) return
    setLoadingNode(true)
    try {
      const res = await getZKNode(clusterId, path)
      setNodeInfo(res.data)
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to load node info')
    } finally {
      setLoadingNode(false)
    }
  }

  const refreshSelectedNode = async (path: string) => {
    if (!clusterId) return
    // Reload node data and children in parallel
    setLoadingNode(true)
    try {
      const [infoRes, childrenRes] = await Promise.all([
        getZKNode(clusterId, path),
        listZKChildren(clusterId, path, 0, PAGE_SIZE),
      ])
      setNodeInfo(infoRes.data)
      const { children, total } = childrenRes.data
      const childNodes = buildChildNodes(path, children, 0, total)
      setTreeData(prev => updateTreeNode(prev, path, childNodes))
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to refresh node')
    } finally {
      setLoadingNode(false)
    }
  }

  const handleSelect = (_: any, { node }: { node: any }) => {
    const zkNode = node as ZKTreeNode
    if (zkNode.isLoadMore) {
      handleLoadMore(zkNode)
      return
    }
    const path = String(zkNode.key)
    setSelectedPath(path)
    fetchNodeInfo(path)
  }

  const handleDeleteNode = () => {
    if (!selectedPath || !clusterId) return
    setDeleteInput('')
    setDeleteRecursiveAck(false)
    setDeleteConfirmOpen(true)
  }

  const doDeleteNode = async () => {
    if (!selectedPath || !clusterId) return
    const hasChildren = (nodeInfo?.stat?.num_children ?? 0) > 0
    try {
      const version = nodeInfo?.stat?.version ?? -1
      await deleteZKNode(clusterId, selectedPath, version, hasChildren)
      message.success('Node deleted')
      setDeleteConfirmOpen(false)
      const parentPath = selectedPath.lastIndexOf('/') === 0 ? '/' : selectedPath.substring(0, selectedPath.lastIndexOf('/'))
      setTreeData(prev => {
        function removeKey(list: ZKTreeNode[]): ZKTreeNode[] {
          return list.filter(n => String(n.key) !== selectedPath).map(n =>
            n.children ? { ...n, children: removeKey(n.children as ZKTreeNode[]) } : n
          )
        }
        return removeKey(prev)
      })
      setSelectedPath(null)
      setNodeInfo(null)
      if (parentPath !== selectedPath) fetchNodeInfo(parentPath)
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Delete failed')
    }
  }

  const handleSaveData = async () => {
    if (!clusterId || !selectedPath || !nodeInfo) return
    try {
      await setZKNodeData(clusterId, selectedPath, editDataValue, nodeInfo.stat.version)
      message.success('Data saved')
      setEditDataOpen(false)
      fetchNodeInfo(selectedPath)
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Save failed')
    }
  }

  const handleAddChild = async (values: any) => {
    if (!clusterId || !selectedPath) return
    const fullPath = buildPath(selectedPath === '/' ? '' : selectedPath, values.name)
    const flagMap: Record<string, number> = { persistent: 0, ephemeral: 1 }
    try {
      await createZKNode(clusterId, {
        path: fullPath,
        data: values.data || '',
        flags: flagMap[values.flags] ?? 0,
        acls: [],
      })
      message.success(`Created ${fullPath}`)
      setAddChildOpen(false)
      addChildForm.resetFields()
      // Refresh children of current node
      if (selectedPath) {
        const res = await listZKChildren(clusterId, selectedPath, 0, PAGE_SIZE)
        const { children, total } = res.data
        const childNodes = buildChildNodes(selectedPath, children, 0, total)
        setTreeData(prev => updateTreeNode(prev, selectedPath, childNodes))
        fetchNodeInfo(selectedPath)
      }
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Create failed')
    }
  }

  const handleSaveACL = async (entries: ACLEntry[], version: number) => {
    if (!clusterId || !selectedPath) return
    const acls = entries.map(e => ({
      scheme: e.scheme,
      id: e.id,
      perms: checkboxToPerms(e.perms),
    }))
    try {
      await setZKACL(clusterId, selectedPath, acls, version)
      message.success('ACL updated')
      setEditACLOpen(false)
      fetchNodeInfo(selectedPath)
    } catch (e: any) {
      message.error(e.response?.data?.error || 'ACL update failed')
    }
  }

  const formatJSON = () => {
    try {
      const pretty = JSON.stringify(JSON.parse(editDataValue), null, 2)
      setEditDataValue(pretty)
    } catch {
      message.warning('Not valid JSON')
    }
  }

  // ---- Stat section ----
  const renderStat = () => {
    if (!nodeInfo?.stat) return null
    const { stat } = nodeInfo
    const lStyle: React.CSSProperties = {
      background: '#fafafa', border: '1px solid #f0f0f0',
      padding: '5px 10px', color: '#888', fontWeight: 500,
      whiteSpace: 'nowrap', fontSize: 12, verticalAlign: 'middle',
    }
    const cStyle: React.CSSProperties = {
      border: '1px solid #f0f0f0', padding: '5px 10px',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      fontSize: 12, verticalAlign: 'middle',
    }
    return (
      <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
        <colgroup>
          <col style={{ width: 95 }} /><col />
          <col style={{ width: 95 }} /><col />
          <col style={{ width: 95 }} /><col />
        </colgroup>
        <tbody>
          <tr>
            <td style={lStyle}>Czxid</td><td style={cStyle}>{stat.czxid}</td>
            <td style={lStyle}>Mzxid</td><td style={cStyle}>{stat.mzxid}</td>
            <td style={lStyle}>Pzxid</td><td style={cStyle}>{stat.pzxid}</td>
          </tr>
          <tr>
            <td style={lStyle}>Ctime</td><td style={cStyle}>{formatTime(stat.ctime)}</td>
            <td style={lStyle}>Mtime</td><td style={cStyle} colSpan={3}>{formatTime(stat.mtime)}</td>
          </tr>
          <tr>
            <td style={lStyle}>Version</td><td style={cStyle}>{stat.version}</td>
            <td style={lStyle}>Cversion</td><td style={cStyle}>{stat.cversion}</td>
            <td style={lStyle}>Aversion</td><td style={cStyle}>{stat.aversion}</td>
          </tr>
          <tr>
            <td style={lStyle}>DataLength</td><td style={cStyle}>{stat.data_length}</td>
            <td style={lStyle}>NumChildren</td><td style={cStyle}>{stat.num_children}</td>
            <td style={lStyle}>EphOwner</td><td style={cStyle}>{stat.ephemeral_owner}</td>
          </tr>
        </tbody>
      </table>
    )
  }

  // ---- ACL tab ----
  const aclColumns = [
    { title: 'Scheme', dataIndex: 'scheme', width: 100, render: (v: string) => <Tag color="blue">{v}</Tag> },
    { title: 'ID', dataIndex: 'id', width: 160 },
    { title: 'Permissions', dataIndex: 'perms_str', width: 120, render: (v: string) => <Tag color="orange">{v || '-'}</Tag> },
    { title: 'Raw', dataIndex: 'perms', width: 80 },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div className="page-header">
        <Space>
          <h2 style={{ margin: 0 }}>ZNode Browser</h2>
          <Select
            style={{ width: 220 }}
            placeholder="Select cluster"
            value={clusterId ?? undefined}
            onChange={v => setClusterId(v)}
          >
            {clusters.map(c => <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>)}
          </Select>
        </Space>
        <Space>
          {clusterStats && (
            <div style={{
              display: 'flex', gap: 16, alignItems: 'center',
              background: '#fafafa', border: '1px solid #f0f0f0',
              borderRadius: 8, padding: '5px 14px', fontSize: 13, color: '#555',
            }}>
              <Tooltip title="Total active watches (server-level)">
                <span style={{ cursor: 'default' }}><Badge color="#faad14" /> Watches: <strong>{clusterStats.watch_count}</strong></span>
              </Tooltip>
              <span style={{ color: '#e8e8e8' }}>|</span>
              <Tooltip title="Total znodes">
                <span style={{ cursor: 'default' }}>Znodes: <strong>{clusterStats.znode_count}</strong></span>
              </Tooltip>
              <span style={{ color: '#e8e8e8' }}>|</span>
              <Tooltip title="Active client connections">
                <span style={{ cursor: 'default' }}>Connections: <strong>{clusterStats.connections}</strong></span>
              </Tooltip>
            </div>
          )}
          <Button icon={<ReloadOutlined />} onClick={() => {
            loadRoot()
            if (clusterId) getZKStats(clusterId).then(res => setClusterStats(res.data)).catch(() => {})
          }} loading={loadingTree} disabled={!clusterId}>
            Refresh
          </Button>
        </Space>
      </div>

      {/* Body: Tree + Detail */}
      <div style={{ display: 'flex', height: 'calc(100vh - 240px)', gap: 16, overflow: 'hidden', marginTop: 16 }}>
        {/* Left: Tree */}
        <div style={{
          width: 320, flexShrink: 0, border: '1px solid #e8e8e8', borderRadius: 8,
          display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden',
        }}>
          {/* Tree panel header */}
          <div style={{
            padding: '10px 14px', borderBottom: '1px solid #f0f0f0',
            fontWeight: 600, fontSize: 13, color: '#444', background: '#fafafa',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
          }}>
            <span>ZNode Tree</span>
            {selectedPath && (
              <Tag style={{ fontSize: 11, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', margin: 0 }}>
                {selectedPath === '/' ? '/' : selectedPath.split('/').pop()}
              </Tag>
            )}
          </div>
          {/* Search box */}
          <div style={{ padding: '8px 10px 4px', flexShrink: 0 }}>
            <Input
              size="small"
              prefix={<SearchOutlined style={{ color: '#bbb', fontSize: 12 }} />}
              placeholder="Filter nodes…"
              value={treeSearch}
              onChange={e => setTreeSearch(e.target.value)}
              allowClear
              style={{ fontSize: 12 }}
            />
          </div>
          {/* Tree content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px 8px', minHeight: 0 }}>
            {loadingTree ? (
              <div style={{ textAlign: 'center', paddingTop: 40 }}><Spin /></div>
            ) : treeData.length === 0 ? (
              <Empty description="Select a cluster to browse" style={{ marginTop: 40 }} />
            ) : (
              <Tree
                treeData={treeData as DataNode[]}
                loadData={onLoadData}
                onSelect={handleSelect}
                expandedKeys={expandedKeys}
                onExpand={keys => setExpandedKeys(keys as string[])}
                selectedKeys={selectedPath ? [selectedPath] : []}
                virtual
                blockNode
                style={{ fontSize: 13 }}
                switcherIcon={(props: any) => {
                  if (props.isLeaf) return null
                  return (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 14, height: 14,
                      transition: 'transform 0.15s ease',
                      transform: props.expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                    }}>
                      <CaretRightFilled style={{ fontSize: 9, color: '#8c8c8c' }} />
                    </span>
                  )
                }}
                icon={(props: any) => {
                  if ((props as any).isLoadMore) return null
                  return props.expanded
                    ? <FolderOpenOutlined style={{ color: '#faad14', fontSize: 13 }} />
                    : <FolderOutlined style={{ color: '#1677ff', fontSize: 13 }} />
                }}
                titleRender={(nodeData: any) => {
                  const node = nodeData as ZKTreeNode
                  if (node.isLoadMore) {
                    return (
                      <span style={{ color: '#bbb', fontSize: 12, fontStyle: 'italic', paddingLeft: 2 }}>
                        {node.title as string}
                      </span>
                    )
                  }
                  const name = node.title as string
                  if (treeSearch) {
                    const idx = name.toLowerCase().indexOf(treeSearch.toLowerCase())
                    if (idx >= 0) {
                      return (
                        <span>
                          {name.slice(0, idx)}
                          <span style={{ background: '#ffe58f', borderRadius: 2, padding: '0 1px' }}>
                            {name.slice(idx, idx + treeSearch.length)}
                          </span>
                          {name.slice(idx + treeSearch.length)}
                        </span>
                      )
                    }
                  }
                  return <span>{name}</span>
                }}
                filterTreeNode={treeSearch ? (node: any) => {
                  if (node.isLoadMore) return false
                  return String(node.title || '').toLowerCase().includes(treeSearch.toLowerCase())
                } : undefined}
              />
            )}
          </div>
        </div>

        {/* Right: Detail Panel */}
        <div style={{ flex: 1, border: '1px solid #e8e8e8', borderRadius: 8, overflowY: 'auto', background: '#fff' }}>
          {!selectedPath ? (
            <Empty description="Select a znode to view details" style={{ marginTop: 80 }} />
          ) : (!nodeInfo && loadingNode) ? (
            <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin /></div>
          ) : nodeInfo ? (
            <div style={{ padding: '16px 20px 24px' }}>
              {/* Node path header */}
              <div style={{
                background: '#f0f5ff', border: '1px solid #d6e4ff', borderRadius: 8,
                padding: '10px 16px', marginBottom: 20,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                  {loadingNode && <Spin size="small" style={{ flexShrink: 0 }} />}
                  <Tooltip title={selectedPath}>
                    <span style={{
                      fontFamily: 'monospace', fontSize: 13, color: '#1d39c4',
                      fontWeight: 500, wordBreak: 'break-all', minWidth: 0,
                    }}>
                      {selectedPath}
                    </span>
                  </Tooltip>
                </div>
                <Space size={6} style={{ flexShrink: 0 }}>
                  {nodeInfo.stat.ephemeral_owner !== 0
                    ? <Tag color="orange" style={{ margin: 0 }}>Ephemeral</Tag>
                    : <Tag color="geekblue" style={{ margin: 0 }}>Persistent</Tag>
                  }
                  <Button icon={<ReloadOutlined />} size="small" loading={loadingNode} onClick={() => refreshSelectedNode(selectedPath)}>
                    Refresh
                  </Button>
                  {canEdit && (
                    <Button icon={<PlusOutlined />} size="small" onClick={() => { addChildForm.resetFields(); setAddChildOpen(true) }}>
                      Add Child
                    </Button>
                  )}
                  {canDelete && selectedPath !== '/' && (
                    <Button danger icon={<DeleteOutlined />} size="small" onClick={handleDeleteNode}>
                      Delete
                    </Button>
                  )}
                </Space>
              </div>

              {/* Data */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ width: 3, height: 14, background: '#1677ff', borderRadius: 2 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#262626' }}>Data</span>
                <span style={{ fontSize: 12, color: '#aaa', marginLeft: 4 }}>{nodeInfo.stat.data_length} B</span>
              </div>
              <pre style={{
                background: '#f8f9fa', border: '1px solid #e8eaed', borderRadius: 6,
                padding: '10px 14px', minHeight: 52, maxHeight: 260, overflowY: 'auto',
                fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all',
                whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.65,
              }}>
                {nodeInfo.data || <span style={{ color: '#bbb', fontStyle: 'italic' }}>empty</span>}
              </pre>
              {canEdit && (
                <Button icon={<EditOutlined />} size="small" style={{ marginTop: 8 }}
                  onClick={() => { setEditDataValue(nodeInfo.data); setEditDataOpen(true) }}>
                  Edit Data
                </Button>
              )}

              {/* Stat */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '20px 0 10px' }}>
                <div style={{ width: 3, height: 14, background: '#52c41a', borderRadius: 2 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#262626' }}>Stat</span>
              </div>
              {renderStat()}

              {/* ACL */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '20px 0 10px' }}>
                <div style={{ width: 3, height: 14, background: '#fa8c16', borderRadius: 2 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#262626' }}>ACL</span>
              </div>
              <Table
                size="small"
                rowKey={(r, i) => `${r.scheme}:${r.id}:${i}`}
                columns={aclColumns}
                dataSource={nodeInfo.acls}
                pagination={false}
              />
              {canEdit && (
                <Button icon={<EditOutlined />} size="small" style={{ marginTop: 8 }} onClick={() => setEditACLOpen(true)}>
                  Edit ACL
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* Edit Data Modal */}
      <Modal
        title="Edit Node Data"
        open={editDataOpen}
        onCancel={() => setEditDataOpen(false)}
        width={640}
        footer={
          <Space>
            <Button onClick={formatJSON}>Format JSON</Button>
            <Button onClick={() => setEditDataOpen(false)}>Cancel</Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSaveData}>Save</Button>
          </Space>
        }
      >
        <div style={{ marginBottom: 4, fontSize: 12, color: '#888' }}>
          Path: {selectedPath} | Version: {nodeInfo?.stat?.version}
        </div>
        <Input.TextArea
          rows={12}
          value={editDataValue}
          onChange={e => setEditDataValue(e.target.value)}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </Modal>

      {/* Add Child Modal */}
      <Modal
        title={`Add Child to ${selectedPath}`}
        open={addChildOpen}
        onCancel={() => setAddChildOpen(false)}
        onOk={() => addChildForm.validateFields().then(handleAddChild)}
        width={520}
        destroyOnClose
      >
        <Form form={addChildForm} layout="vertical">
          <Form.Item name="name" label="Child Name" rules={[{ required: true, message: 'Name is required' }, {
            pattern: /^[^/]+$/, message: 'Name cannot contain /'
          }]}>
            <Input placeholder="nodename" />
          </Form.Item>
          <Form.Item name="data" label="Data">
            <Input.TextArea rows={4} placeholder="(optional)" style={{ fontFamily: 'monospace' }} />
          </Form.Item>
          <Form.Item name="flags" label="Node Type" initialValue="persistent">
            <Select>
              <Select.Option value="persistent">Persistent</Select.Option>
              <Select.Option value="ephemeral">Ephemeral</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit ACL Modal */}
      {nodeInfo && (
        <ACLEditModal
          open={editACLOpen}
          acls={nodeInfo.acls}
          version={nodeInfo.stat.aversion}
          onCancel={() => setEditACLOpen(false)}
          onSave={handleSaveACL}
        />
      )}

      {/* Delete Confirm Modal */}
      {(() => {
        const confirmLabel = selectedPath ?? ''
        const hasChildren = (nodeInfo?.stat?.num_children ?? 0) > 0
        const okDisabled = deleteInput !== confirmLabel || (hasChildren && !deleteRecursiveAck)
        return (
          <Modal
            title="Confirm deletion"
            open={deleteConfirmOpen}
            okText="Delete"
            okButtonProps={{ danger: true, disabled: okDisabled }}
            onOk={doDeleteNode}
            onCancel={() => setDeleteConfirmOpen(false)}
            destroyOnClose
          >
            <p style={{ marginBottom: 8 }}>This will permanently delete the znode and all its children.</p>
            {hasChildren && (
              <div style={{ background: '#fff2e8', border: '1px solid #ffbb96', borderRadius: 4, padding: '8px 12px', marginBottom: 12 }}>
                <p style={{ color: '#d4380d', fontWeight: 600, marginBottom: 6 }}>
                  ⚠ This node has <strong>{nodeInfo!.stat.num_children}</strong> direct child(ren). All descendants will be deleted recursively and cannot be recovered.
                </p>
                <Checkbox
                  checked={deleteRecursiveAck}
                  onChange={e => setDeleteRecursiveAck(e.target.checked)}
                >
                  I understand this will permanently delete all child nodes
                </Checkbox>
              </div>
            )}
            <p>Type <strong>{confirmLabel}</strong> to confirm:</p>
            <Input
              value={deleteInput}
              onChange={e => setDeleteInput(e.target.value)}
              onPressEnter={() => { if (!okDisabled) doDeleteNode() }}
              autoFocus
              placeholder={confirmLabel}
            />
          </Modal>
        )
      })()}
    </div>
  )
}
