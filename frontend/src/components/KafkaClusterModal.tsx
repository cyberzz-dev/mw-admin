import React, { useEffect } from 'react'
import { Modal, Form, Input, Select, Button, Space, InputNumber, Switch } from 'antd'
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'

const { Option } = Select

const SSL_TYPES = ['SSL_SCRAM-SHA-256', 'SSL_SCRAM-SHA-512']

interface Props {
  open: boolean
  initialValues?: any
  onCancel: () => void
  onSubmit: (values: any) => void
  title: string
}

export default function KafkaClusterModal({ open, initialValues, onCancel, onSubmit, title }: Props) {
  const [form] = Form.useForm()

  useEffect(() => {
    if (open) {
      form.resetFields()
      if (initialValues) {
        form.setFieldsValue({
          ...initialValues,
          password: initialValues.password || '',
          nodes: initialValues.nodes || [{ host: '', port: 9092 }],
          tls_skip_verify: initialValues.tls_skip_verify !== false,
        })
      } else {
        form.setFieldsValue({ auth_type: 'PLAINTEXT', nodes: [{ host: '', port: 9092 }], tls_skip_verify: true, metric_port: 9308 })
      }
    }
  }, [open, initialValues])

  const handleOk = () => {
    form.validateFields().then(values => {
      onSubmit(values)
    })
  }

  return (
    <Modal title={title} open={open} onCancel={onCancel} onOk={handleOk} width={640} destroyOnClose>
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="Cluster Name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="description" label="Description">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item name="version" label="Version">
          <Input placeholder="e.g. 3.6.0" />
        </Form.Item>
        <Form.Item name="auth_type" label="Authentication" rules={[{ required: true }]}>
          <Select>
            <Option value="PLAINTEXT">PLAINTEXT</Option>
            <Option value="SASL_PLAIN">SASL_PLAIN</Option>
            <Option value="SCRAM-SHA-256">SCRAM-SHA-256</Option>
            <Option value="SCRAM-SHA-512">SCRAM-SHA-512</Option>
            <Option value="SSL_SCRAM-SHA-256">SSL + SCRAM-SHA-256</Option>
            <Option value="SSL_SCRAM-SHA-512">SSL + SCRAM-SHA-512</Option>
          </Select>
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.auth_type !== cur.auth_type}>
          {({ getFieldValue }) =>
            getFieldValue('auth_type') !== 'PLAINTEXT' ? (
              <>
                <Form.Item name="username" label="Username" rules={[{ required: true }]}>
                  <Input />
                </Form.Item>
                <Form.Item name="password" label="Password">
                  <Input.Password
                    placeholder={initialValues ? 'Leave blank to keep unchanged' : ''}
                    autoComplete="new-password"
                  />
                </Form.Item>
              </>
            ) : null
          }
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.auth_type !== cur.auth_type}>
          {({ getFieldValue }) =>
            SSL_TYPES.includes(getFieldValue('auth_type')) ? (
              <>
                <Form.Item name="tls_skip_verify" label="Skip TLS Certificate Verify" valuePropName="checked">
                  <Switch checkedChildren="Skip" unCheckedChildren="Verify" />
                </Form.Item>
                <Form.Item name="tls_ca_cert" label="CA Certificate (PEM, optional)" help="Leave empty to use system CA store">
                  <Input.TextArea
                    rows={5}
                    placeholder={`-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----`}
                    style={{ fontFamily: 'monospace', fontSize: 12 }}
                  />
                </Form.Item>
              </>
            ) : null
          }
        </Form.Item>

        <Form.Item name="metric_port" label="Metric Port" extra="Prometheus kafka_exporter port (same for all broker nodes). Default: 9308.">
          <InputNumber min={0} max={65535} style={{ width: 140 }} placeholder="9308" />
        </Form.Item>

        <Form.List name="nodes">
          {(fields, { add, remove }) => (
            <>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>Broker Nodes</div>
              {fields.map(({ key, name, ...restField }) => (
                <Space key={key} style={{ display: 'flex', marginBottom: 4 }} align="baseline">
                  <Form.Item {...restField} name={[name, 'host']} rules={[{ required: true, message: 'Host is required' }]}>
                    <Input placeholder="Host/IP" style={{ width: 200 }} />
                  </Form.Item>
                  <Form.Item {...restField} name={[name, 'port']} rules={[{ required: true }]}>
                    <InputNumber placeholder="Port" min={1} max={65535} style={{ width: 100 }} />
                  </Form.Item>
                  {fields.length > 1 && (
                    <MinusCircleOutlined onClick={() => remove(name)} style={{ color: 'red' }} />
                  )}
                </Space>
              ))}
              <Button type="dashed" onClick={() => add({ host: '', port: 9092 })} icon={<PlusOutlined />}>
                Add Node
              </Button>
            </>
          )}
        </Form.List>
      </Form>
    </Modal>
  )
}
