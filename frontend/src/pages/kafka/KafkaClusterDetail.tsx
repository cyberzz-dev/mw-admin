import React from 'react'
import { Drawer, Tabs } from 'antd'
import KafkaTopics from './KafkaTopics'
import KafkaConsumerGroups from './KafkaConsumerGroups'
import KafkaClusterConfig from './KafkaClusterConfig'
import KafkaNodes from './KafkaNodes'
import KafkaReassignmentTasks from './KafkaReassignmentTasks'

interface Props {
  cluster: any | null
  onClose: () => void
}

export default function KafkaClusterDetail({ cluster, onClose }: Props) {
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
          { key: 'nodes', label: 'Nodes', children: <KafkaNodes fixedClusterId={cluster?.id} /> },
          { key: 'topics', label: 'Topics', children: <KafkaTopics fixedClusterId={cluster?.id} /> },
          { key: 'consumer-groups', label: 'Consumer Groups', children: <KafkaConsumerGroups fixedClusterId={cluster?.id} /> },
          { key: 'config', label: 'Cluster Config', children: <KafkaClusterConfig fixedClusterId={cluster?.id} /> },
          { key: 'reassignment-tasks', label: 'Reassignment Tasks', children: <KafkaReassignmentTasks fixedClusterId={cluster?.id} /> },
        ]}
      />
    </Drawer>
  )
}
