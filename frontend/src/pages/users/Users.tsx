import React, { useState, useEffect } from 'react'
import {
  Table, Button, message, Modal, Form, Input,
  Select, Space, Tag
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons'
import { listUsers, createUser, updateUser, deleteUser } from '../../services/api'

const PERMISSION_GROUPS = [
  {
    label: 'Kafka Cluster',
    options: [
      { value: 'kafka_cluster_add',    label: 'Add' },
      { value: 'kafka_cluster_edit',   label: 'Edit / Config' },
      { value: 'kafka_cluster_delete', label: 'Delete' },
    ],
  },
  {
    label: 'Kafka Topic',
    options: [
      { value: 'kafka_topic_add',    label: 'Add' },
      { value: 'kafka_topic_edit',   label: 'Adjust Partitions / Replicas / Migrate / Config' },
      { value: 'kafka_topic_delete', label: 'Delete' },
    ],
  },
  {
    label: 'Kafka Consumer Group',
    options: [
      { value: 'kafka_consumer_group_delete', label: 'Delete / Reset Offsets' },
    ],
  },
  {
    label: 'Elasticsearch Cluster',
    options: [
      { value: 'es_cluster_add',    label: 'Add' },
      { value: 'es_cluster_edit',   label: 'Edit' },
      { value: 'es_cluster_delete', label: 'Delete' },
    ],
  },
  {
    label: 'ZooKeeper Cluster',
    options: [
      { value: 'zk_cluster_add',    label: 'Add' },
      { value: 'zk_cluster_edit',   label: 'Edit' },
      { value: 'zk_cluster_delete', label: 'Delete' },
    ],
  },
  {
    label: 'ZooKeeper Node',
    options: [
      { value: 'zk_node_edit',   label: 'Create / Edit / Set ACL' },
      { value: 'zk_node_delete', label: 'Delete' },
    ],
  },
]

const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap(g =>
  g.options.map(o => ({ value: o.value, label: `${g.label} - ${o.label}` }))
)

export default function Users() {
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form] = Form.useForm()
  const [deleteConfirm, setDeleteConfirm] = useState<{ label: string; onOk: () => void } | null>(null)
  const [deleteInput, setDeleteInput] = useState('')

  const fetchUsers = async () => {
    setLoading(true)
    try {
      const res = await listUsers()
      setUsers(res.data || [])
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to fetch users')
    }
    setLoading(false)
  }

  useEffect(() => { fetchUsers() }, [])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ role: 'user', permissions: [], view_scope: 'all' })
    setModalOpen(true)
  }

  const openEdit = (record: any) => {
    setEditing(record)
    let perms: string[] = []
    if (record.permissions) {
      try { perms = JSON.parse(record.permissions) } catch { perms = [] }
    }
    form.setFieldsValue({
      username: record.username,
      role: record.role,
      permissions: perms,
      view_scope: record.view_scope || 'all',
      password: '',
    })
    setModalOpen(true)
  }

  const handleSubmit = async (values: any) => {
    const payload = {
      username: values.username,
      password: values.password || undefined,
      role: values.role,
      permissions: JSON.stringify(values.role === 'admin' ? [] : (values.permissions || [])),
      view_scope: values.role === 'admin' ? 'all' : (values.view_scope || 'all'),
    }
    try {
      if (editing) {
        await updateUser(editing.id, payload)
        message.success('Updated successfully')
      } else {
        await createUser(payload)
        message.success('Created successfully')
      }
      setModalOpen(false)
      fetchUsers()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Operation failed')
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteUser(id)
      message.success('Deleted successfully')
      fetchUsers()
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to delete')
    }
  }

  const openDeleteConfirm = (label: string, onOk: () => void) => {
    setDeleteInput('')
    setDeleteConfirm({ label, onOk })
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 70, sorter: (a: any, b: any) => a.id - b.id, defaultSortOrder: 'ascend' as const },
    { title: 'Username', dataIndex: 'username', width: 160, sorter: (a: any, b: any) => (a.username || '').localeCompare(b.username || '') },
    {
      title: 'Role', dataIndex: 'role', width: 100,
      render: (v: string) => v === 'admin'
        ? <Tag color="gold">Admin</Tag>
        : <Tag color="blue">User</Tag>,
    },
    {
      title: 'Permissions', dataIndex: 'permissions', width: 500,
      render: (v: string, record: any) => {
        if (record.role === 'admin') return <Tag color="gold">All permissions</Tag>
        let perms: string[] = []
        try { perms = JSON.parse(v || '[]') } catch { perms = [] }
        if (!perms.length) return <span style={{ color: '#aaa' }}>No permissions</span>
        return (
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {perms.map(p => {
              const found = ALL_PERMISSIONS.find(x => x.value === p)
              return <Tag key={p}>{found?.label || p}</Tag>
            })}
          </span>
        )
      },
    },
    {
      title: 'View Scope', dataIndex: 'view_scope', width: 160,
      render: (v: string, record: any) => {
        if (record.role === 'admin') return <Tag color="gold">All (Admin)</Tag>
        return v === 'own'
          ? <Tag color="cyan">Own clusters only</Tag>
          : <Tag color="green">All clusters</Tag>
      },
    },
    {
      title: 'Actions', width: 140,
      render: (_: any, record: any) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>Edit</Button>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => openDeleteConfirm(record.username, () => handleDelete(record.id))}>Delete</Button>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div className="page-header">
        <h2 style={{ margin: 0 }}>Users</h2>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchUsers} loading={loading}>Refresh</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Add User</Button>
        </Space>
      </div>

      <Table rowKey="id" columns={columns} dataSource={users} loading={loading} />

      <Modal
        title={editing ? 'Edit User' : 'Add User'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        destroyOnClose
        width={560}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="username" label="Username" rules={[{ required: true, message: 'Username is required' }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="password"
            label={editing ? 'New Password (leave blank to keep unchanged)' : 'Password'}
            rules={editing ? [] : [{ required: true, message: 'Password is required' }]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: true }]}>
            <Select options={[
              { value: 'admin', label: 'Admin (all permissions)' },
              { value: 'user', label: 'User' },
            ]} />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.role !== cur.role}
          >
            {({ getFieldValue }) =>
              getFieldValue('role') !== 'admin' ? (
                <>
                  <Form.Item name="permissions" label="Permissions">
                    <Select
                      mode="multiple"
                      showSearch
                      optionFilterProp="label"
                      placeholder="Select permissions…"
                      maxTagCount="responsive"
                      style={{ width: '100%' }}
                      options={PERMISSION_GROUPS.map(g => ({
                        label: g.label,
                        options: g.options.map(o => ({
                          value: o.value,
                          label: `${g.label} - ${o.label}`,
                        })),
                      }))}
                    />
                  </Form.Item>
                  <Form.Item name="view_scope" label="Cluster View Scope">
                    <Select options={[
                      { value: 'all', label: 'All clusters' },
                      { value: 'own', label: 'Own clusters only (full access to own)' },
                    ]} />
                  </Form.Item>
                </>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>

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
