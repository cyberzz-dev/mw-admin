import React, { useEffect } from 'react'
import { Modal, Form, Input, Select } from 'antd'

const { Option } = Select

interface Props {
  open: boolean
  initialValues?: any
  onCancel: () => void
  onSubmit: (values: any) => void
  title: string
}

export default function ZKClusterModal({ open, initialValues, onCancel, onSubmit, title }: Props) {
  const [form] = Form.useForm()

  useEffect(() => {
    if (open) {
      form.resetFields()
      if (initialValues) {
        form.setFieldsValue({
          ...initialValues,
          password: initialValues.password || '',
          sasl_mechanism: initialValues.sasl_mechanism || 'DIGEST-MD5',
        })
      } else {
        form.setFieldsValue({ auth_scheme: 'none', sasl_mechanism: 'DIGEST-MD5' })
      }
    }
  }, [open, initialValues])

  const handleOk = () => {
    form.validateFields().then(values => onSubmit(values))
  }

  return (
    <Modal title={title} open={open} onCancel={onCancel} onOk={handleOk} width={560} destroyOnClose>
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="Cluster Name" rules={[{ required: true, message: 'Cluster name is required' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="description" label="Description">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item
          name="servers"
          label="Servers"
          rules={[{ required: true, message: 'Servers are required' }]}
          extra="Comma-separated list of host:port, e.g. zk1:2181,zk2:2181"
        >
          <Input placeholder="host1:2181,host2:2181,host3:2181" />
        </Form.Item>
        <Form.Item name="auth_scheme" label="Auth Scheme" rules={[{ required: true }]}>
          <Select>
            <Option value="none">None (no authentication)</Option>
            <Option value="digest">Digest (username:password)</Option>
            <Option value="sasl">SASL/PLAIN (username + password via SASL PLAIN mechanism)</Option>
          </Select>
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.auth_scheme !== cur.auth_scheme}>
          {({ getFieldValue }) =>
            getFieldValue('auth_scheme') === 'sasl' ? (
              <Form.Item name="sasl_mechanism" label="SASL Mechanism" rules={[{ required: true, message: 'SASL mechanism is required' }]}
                extra="DIGEST-MD5 is the default for most ZooKeeper clusters. Use PLAIN only if the server is explicitly configured for it.">
                <Select defaultValue="DIGEST-MD5">
                  <Option value="DIGEST-MD5">DIGEST-MD5 (recommended)</Option>
                  <Option value="PLAIN">PLAIN</Option>
                </Select>
              </Form.Item>
            ) : null
          }
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.auth_scheme !== cur.auth_scheme}>
          {({ getFieldValue }) =>
            getFieldValue('auth_scheme') !== 'none' ? (
              <>
                <Form.Item name="username" label="Username" rules={[{ required: true, message: 'Username is required' }]}>
                  <Input />
                </Form.Item>
                <Form.Item name="password" label="Password" rules={[{ required: !initialValues, message: 'Password is required' }]}>
                  <Input.Password
                    placeholder={initialValues ? 'Leave blank to keep unchanged' : ''}
                    autoComplete="new-password"
                  />
                </Form.Item>
              </>
            ) : null
          }
        </Form.Item>
      </Form>
    </Modal>
  )
}
