import React, { useEffect } from 'react'
import { Modal, Form, Input, Select, Button, Space, InputNumber } from 'antd'
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'

const { Option } = Select

interface Props {
  open: boolean
  initialValues?: any
  onCancel: () => void
  onSubmit: (values: any) => void
  title: string
}

export default function ESClusterModal({ open, initialValues, onCancel, onSubmit, title }: Props) {
  const [form] = Form.useForm()

  useEffect(() => {
    if (open) {
      form.resetFields()
      if (initialValues) {
        form.setFieldsValue({
          ...initialValues,
          password: initialValues.password || '',
          nodes: initialValues.nodes || [{ host: '', port: 9200 }],
        })
      } else {
        form.setFieldsValue({ scheme: 'http', nodes: [{ host: '', port: 9200 }] })
      }
    }
  }, [open, initialValues])

  const handleOk = () => {
    form.validateFields().then(values => onSubmit(values))
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
        <Form.Item name="scheme" label="Scheme" rules={[{ required: true }]}>
          <Select>
            <Option value="http">HTTP</Option>
            <Option value="https">HTTPS</Option>
          </Select>
        </Form.Item>
        <Form.Item name="username" label="Username">
          <Input />
        </Form.Item>
        <Form.Item name="password" label="Password">
          <Input.Password
            placeholder={initialValues ? 'Leave blank to keep unchanged' : ''}
            autoComplete="new-password"
          />
        </Form.Item>

        <Form.List name="nodes">
          {(fields, { add, remove }) => (
            <>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>ES Nodes</div>
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
              <Button type="dashed" onClick={() => add({ host: '', port: 9200 })} icon={<PlusOutlined />}>
                Add Node
              </Button>
            </>
          )}
        </Form.List>
      </Form>
    </Modal>
  )
}
