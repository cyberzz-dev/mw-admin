import React, { useState } from 'react'
import { BrowserRouter, Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom'
import { Layout, Breadcrumb, Dropdown, Avatar, Space, Tooltip } from 'antd'
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
  LogoutOutlined,
  BellOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons'
import KafkaClusters from './pages/kafka/KafkaClusters'
import KafkaTopics from './pages/kafka/KafkaTopics'
import KafkaConsumerGroups from './pages/kafka/KafkaConsumerGroups'
import KafkaClusterConfig from './pages/kafka/KafkaClusterConfig'
import KafkaNodes from './pages/kafka/KafkaNodes'
import ESClusters from './pages/es/ESClusters'
import ESIndices from './pages/es/ESIndices'
import ESNodes from './pages/es/ESNodes'
import ESTemplates from './pages/es/ESTemplates'
import ESComponentTemplates from './pages/es/ESComponentTemplates'
import ESILMPolicies from './pages/es/ESILMPolicies'
import ESDevConsole from './pages/es/ESDevConsole'
import ZKClusters from './pages/zk/ZKClusters'
import ZKNodes from './pages/zk/ZKNodes'
import Users from './pages/users/Users'
import Login from './pages/auth/Login'
import { AuthProvider, useAuth } from './contexts/AuthContext'

const { Header, Sider, Content } = Layout

const breadcrumbMap: Record<string, string[]> = {
  '/kafka/clusters':        ['Kafka', 'Clusters'],
  '/kafka/topics':          ['Kafka', 'Topics'],
  '/kafka/consumer-groups': ['Kafka', 'Consumer Groups'],
  '/kafka/config':          ['Kafka', 'Cluster Configuration'],
  '/kafka/nodes':           ['Kafka', 'Nodes'],
  '/es/clusters':           ['Elasticsearch', 'Clusters'],
  '/es/indices':            ['Elasticsearch', 'Indices'],
  '/es/nodes':              ['Elasticsearch', 'Nodes'],
  '/es/templates':            ['Elasticsearch', 'Index Templates'],
  '/es/component-templates':  ['Elasticsearch', 'Component Templates'],
  '/es/ilm':                  ['Elasticsearch', 'ILM Policies'],
  '/es/console':            ['Elasticsearch', 'Dev Console'],
  '/zk/clusters':           ['ZooKeeper', 'Clusters'],
  '/zk/nodes':              ['ZooKeeper', 'ZNode Browser'],
  '/users':                 ['Administration', 'Users'],
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAuth()
  if (!isAdmin) return <Navigate to="/" replace />
  return <>{children}</>
}

function SideNav({ collapsed }: { collapsed: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAdmin, hasComponent } = useAuth()
  const currentPath = location.pathname || '/kafka/clusters'
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(['kafka', 'es', 'zk', 'system'])
  )

  const toggleGroup = (key: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const allGroups = [
    {
      key: 'kafka',
      label: 'Kafka',
      items: [
        { path: '/kafka/clusters', label: 'Clusters' },
        { path: '/kafka/topics', label: 'Topics' },
        { path: '/kafka/consumer-groups', label: 'Consumer Groups' },
        { path: '/kafka/config', label: 'Cluster Configuration' },
        { path: '/kafka/nodes', label: 'Nodes' },
      ],
    },
    {
      key: 'es',
      label: 'Elasticsearch',
      items: [
        { path: '/es/clusters', label: 'Clusters' },
        { path: '/es/nodes', label: 'Nodes' },
        { path: '/es/indices', label: 'Indices' },
        { path: '/es/templates', label: 'Index Templates' },
        { path: '/es/component-templates', label: 'Component Templates' },
        { path: '/es/ilm', label: 'ILM Policies' },
        { path: '/es/console', label: 'Dev Console' },
      ],
    },
    {
      key: 'zk',
      label: 'ZooKeeper',
      items: [
        { path: '/zk/clusters', label: 'Clusters' },
        { path: '/zk/nodes', label: 'ZNode Browser' },
      ],
    },
  ]

  const groups = [
    ...allGroups.filter(g => hasComponent(g.key)),
    ...(isAdmin ? [{
      key: 'system',
      label: 'Administration',
      items: [{ path: '/users', label: 'Users' }],
    }] : []),
  ]

  if (collapsed) {
    return (
      <div style={{ padding: '8px 0' }}>
        {groups.flatMap(g => g.items).map(item => {
          const isActive = item.path === currentPath
          return (
            <Tooltip key={item.path} title={item.label} placement="right">
              <div
                onClick={() => navigate(item.path)}
                style={{
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: isActive ? 700 : 400,
                  color: isActive ? '#0972d3' : '#414d5c',
                  background: isActive ? '#e8f4fd' : 'transparent',
                  borderRadius: 4,
                  margin: '1px 4px',
                }}
              >
                {item.label.slice(0, 1)}
              </div>
            </Tooltip>
          )
        })}
      </div>
    )
  }

  return (
    <div style={{ padding: '8px 0' }}>
      {groups.map(group => {
        const isOpen = openGroups.has(group.key)
        return (
          <div key={group.key}>
            <div
              onClick={() => toggleGroup(group.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '12px 16px 5px',
                cursor: 'pointer',
                userSelect: 'none' as const,
              }}
            >
              <span style={{
                fontSize: 9,
                color: '#414d5c',
                display: 'inline-block',
                transition: 'transform 0.2s',
                transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                lineHeight: 1,
              }}>▼</span>
              <span style={{
                fontSize: 12,
                fontWeight: 700,
                color: '#0f1111',
                letterSpacing: '0.01em',
              }}>{group.label}</span>
            </div>
            {isOpen && group.items.map(item => {
              const isActive = item.path === currentPath
              return (
                <div
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={isActive ? 'sidenav-item active' : 'sidenav-item'}
                  style={{
                    padding: '6px 16px 6px 28px',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: isActive ? 700 : 400,
                    color: isActive ? '#0972d3' : '#414d5c',
                    background: isActive ? '#e8f4fd' : 'transparent',
                    borderRadius: 4,
                    margin: '1px 6px',
                    lineHeight: '20px',
                  }}
                >
                  {item.label}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout, isAdmin, hasComponent } = useAuth()
  const [collapsed, setCollapsed] = useState(false)

  // Determine the default landing page based on component access
  const defaultPath = (() => {
    if (hasComponent('kafka')) return '/kafka/clusters'
    if (hasComponent('es')) return '/es/clusters'
    if (hasComponent('zk')) return '/zk/clusters'
    return '/kafka/clusters'
  })()

  const selectedKey = location.pathname || '/kafka/clusters'
  const crumbs = breadcrumbMap[selectedKey] || []

  const userMenu = {
    items: [
      { key: 'logout', icon: <LogoutOutlined />, label: 'Sign out', danger: true },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'logout') { logout().then(() => navigate('/login')) }
    },
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* AWS-style top navigation bar */}
      <Header style={{
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        background: '#232f3e',
        borderBottom: '2px solid #ec7211',
        height: 48,
        position: 'sticky',
        top: 0,
        zIndex: 1000,
      }}>
        {/* Logo */}
        <Space size={0} align="center" style={{ flexShrink: 0 }}>
          <div
            onClick={() => setCollapsed(!collapsed)}
            style={{
              width: 36, height: 36,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              color: '#d5dbdb',
              borderRadius: 4,
              marginRight: 4,
              flexShrink: 0,
            }}
          >
            {collapsed ? <MenuUnfoldOutlined style={{ fontSize: 16 }} /> : <MenuFoldOutlined style={{ fontSize: 16 }} />}
          </div>
          <span style={{
            color: '#ffffff',
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: '0.02em',
            userSelect: 'none',
            whiteSpace: 'nowrap',
          }}>
            Middleware Console
          </span>
        </Space>
        <div style={{ flex: 1 }} />
        {/* Right icons + user */}
        <Space size={2}>
          <div style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#d5dbdb', borderRadius: 4 }}>
            <BellOutlined style={{ fontSize: 16 }} />
          </div>
          <div style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#d5dbdb', borderRadius: 4 }}>
            <QuestionCircleOutlined style={{ fontSize: 16 }} />
          </div>
          <div style={{ width: 1, height: 22, background: '#3a4a5c', margin: '0 8px' }} />
          <Dropdown menu={userMenu} placement="bottomRight">
            <Space style={{ cursor: 'pointer', color: '#d5dbdb', fontSize: 13 }}>
              <Avatar size={26} icon={<UserOutlined />} style={{ background: '#3a4a5c' }} />
              <span>{user?.username}</span>
              {user?.role === 'admin' && (
                <span style={{ fontSize: 11, color: '#ff9900', fontWeight: 600 }}>Admin</span>
              )}
            </Space>
          </Dropdown>
        </Space>
      </Header>

      <Layout>
        {/* Sidebar */}
        <Sider
          collapsed={collapsed}
          width={220}
          collapsedWidth={56}
          style={{
            background: '#ffffff',
            borderRight: '1px solid #e5e7e8',
            position: 'sticky',
            top: 48,
            height: 'calc(100vh - 48px)',
            overflow: 'auto',
            transition: 'width 0.2s ease, min-width 0.2s ease, max-width 0.2s ease, flex 0.2s ease',
          }}
        >
          <SideNav collapsed={collapsed} />
        </Sider>

        {/* Main content area */}
        <Layout style={{ background: '#eaeded', transition: 'all 0.2s ease' }}>
          {/* Breadcrumb bar */}
          <div style={{
            padding: '8px 24px',
            background: '#ffffff',
            borderBottom: '1px solid #e1e4e5',
          }}>
            <Breadcrumb
              items={[
                { title: 'Console' },
                ...crumbs.map(c => ({ title: c })),
              ]}
              style={{ fontSize: 12, color: '#545b64' }}
            />
          </div>

          {/* Page content */}
          <Content style={{ padding: '20px 24px', minHeight: 'calc(100vh - 48px - 37px)' }}>
            <div style={{
              background: '#ffffff',
              borderRadius: 6,
              padding: '20px 24px',
              border: '1px solid #d5dbdb',
              boxShadow: '0 1px 3px rgba(0,28,36,.08)',
            }}>
              <Routes>
                <Route path="/" element={<Navigate to={defaultPath} replace />} />
                <Route path="/kafka/clusters" element={<KafkaClusters />} />
                <Route path="/kafka/topics" element={<KafkaTopics />} />
                <Route path="/kafka/consumer-groups" element={<KafkaConsumerGroups />} />
                <Route path="/kafka/config" element={<KafkaClusterConfig />} />
                <Route path="/kafka/nodes" element={<KafkaNodes />} />
                <Route path="/es/clusters" element={<ESClusters />} />
                <Route path="/es/indices" element={<ESIndices />} />
                <Route path="/es/nodes" element={<ESNodes />} />
                <Route path="/es/templates" element={<ESTemplates />} />
                <Route path="/es/component-templates" element={<ESComponentTemplates />} />
                <Route path="/es/ilm" element={<ESILMPolicies />} />
                <Route path="/es/console" element={<ESDevConsole />} />
                <Route path="/zk/clusters" element={<ZKClusters />} />
                <Route path="/zk/nodes" element={<ZKNodes />} />
                <Route path="/users" element={
                  <RequireAdmin><Users /></RequireAdmin>
                } />
              </Routes>
            </div>
          </Content>
        </Layout>
      </Layout>
    </Layout>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          } />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
