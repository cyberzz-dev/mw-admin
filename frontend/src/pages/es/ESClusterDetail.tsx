import React from 'react'
import { Drawer, Tabs } from 'antd'
import ESNodes from './ESNodes'
import ESIndices from './ESIndices'
import ESTemplates from './ESTemplates'
import ESILMPolicies from './ESILMPolicies'
import ESDevConsole from './ESDevConsole'

interface Props {
  cluster: any | null
  onClose: () => void
}

export default function ESClusterDetail({ cluster, onClose }: Props) {
  return (
    <Drawer
      title={cluster?.name}
      open={!!cluster}
      onClose={onClose}
      width="90vw"
      destroyOnClose
      styles={{ body: { padding: '0 16px' } }}
    >
      <Tabs
        items={[
          { key: 'nodes', label: 'Nodes', children: <ESNodes fixedClusterId={cluster?.id} /> },
          { key: 'indices', label: 'Indices', children: <ESIndices fixedClusterId={cluster?.id} /> },
          { key: 'templates', label: 'Index Templates', children: <ESTemplates fixedClusterId={cluster?.id} /> },
          { key: 'ilm', label: 'ILM Policies', children: <ESILMPolicies fixedClusterId={cluster?.id} /> },
          { key: 'console', label: 'Dev Console', children: <ESDevConsole fixedClusterId={cluster?.id} /> },
        ]}
      />
    </Drawer>
  )
}
