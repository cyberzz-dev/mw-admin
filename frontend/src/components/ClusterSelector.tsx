import React, { useEffect, useState } from 'react'
import { Select, Form } from 'antd'

const { Option } = Select

interface Cluster {
  id: number
  name: string
}

interface Props {
  value?: number
  onChange?: (id: number) => void
  fetchClusters: () => Promise<any>
  placeholder?: string
}

export default function ClusterSelector({ value, onChange, fetchClusters, placeholder }: Props) {
  const [clusters, setClusters] = useState<Cluster[]>([])

  useEffect(() => {
    fetchClusters().then(res => setClusters(res.data || []))
  }, [])

  return (
    <Select
      value={value}
      onChange={onChange}
      placeholder={placeholder || 'Select cluster'}
      style={{ width: 240 }}
      allowClear
    >
      {clusters.map(c => (
        <Option key={c.id} value={c.id}>{c.name}</Option>
      ))}
    </Select>
  )
}
