import React, { useState } from 'react'
import { Form, Input, Button, message, Card } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { loginApi } from '../../services/api'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (values: { username: string; password: string }) => {
    setLoading(true)
    try {
      const res = await loginApi(values.username, values.password)
      const { token, user } = res.data
      // parse permissions from JSON string to array
      let permissions: string[] = []
      if (user.permissions) {
        try { permissions = JSON.parse(user.permissions) } catch { permissions = [] }
      }
      login(token, { ...user, permissions })
      navigate('/', { replace: true })
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f2f3f3',
    }}>
      {/* Header bar */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 48,
        background: '#232f3e',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: 12,
      }}>
        <div style={{ width: 4, height: 28, background: '#ff9900', borderRadius: 2 }} />
        <span style={{ color: '#fff', fontSize: 16, fontWeight: 700 }}>Middleware Console</span>
      </div>

      <Card
        style={{ width: 360, marginTop: 48, border: '1px solid #d5d9d9', borderRadius: 4 }}
        bodyStyle={{ padding: '32px 32px 24px' }}
      >
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 20, fontWeight: 600, color: '#16191f' }}>Sign in</div>
          <div style={{ fontSize: 13, color: '#687078', marginTop: 4 }}>Enter your credentials to sign in</div>
        </div>
        <Form layout="vertical" onFinish={handleSubmit} autoComplete="off">
          <Form.Item name="username" label="Username" rules={[{ required: true, message: 'Enter your username' }]}>
            <Input prefix={<UserOutlined />} placeholder="Username" size="large" />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, message: 'Enter your password' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="Password" size="large" />
          </Form.Item>
          <Form.Item style={{ marginTop: 8, marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" loading={loading} block size="large">
              Sign in
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
