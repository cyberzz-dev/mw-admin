import React from 'react'
import { Drawer, Tabs } from 'antd'
import ZKNodes from './ZKNodes'

interface Props {
  cluster: any | null
  onClose: () => void
}

export default function ZKClusterDetail({ cluster, onClose }: Props) {
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
          { key: 'znodes', label: 'ZNode Browser', children: <ZKNodes fixedClusterId={cluster?.id} /> },
        ]}
      />
    </Drawer>
  )
}
