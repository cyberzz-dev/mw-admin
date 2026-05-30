import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Select, Space, Tag, Tooltip, AutoComplete, message, Divider } from 'antd'
import {
  SendOutlined,
  DeleteOutlined,
  FormatPainterOutlined,
  HistoryOutlined,
  CopyOutlined,
} from '@ant-design/icons'
import Editor, { useMonaco } from '@monaco-editor/react'
import ClusterSelector from '../../components/ClusterSelector'
import { listESClusters, esDevConsole } from '../../services/api'

// ─── ES API path completions ────────────────────────────────────────────────

const COMMON_PATHS = [
  // _cat APIs
  '/_cat/indices?v',
  '/_cat/indices?v&s=index',
  '/_cat/indices?v&health=red',
  '/_cat/nodes?v',
  '/_cat/health?v',
  '/_cat/shards?v',
  '/_cat/aliases?v',
  '/_cat/allocation?v',
  '/_cat/count',
  '/_cat/fielddata?v',
  '/_cat/master?v',
  '/_cat/plugins?v',
  '/_cat/recovery?v',
  '/_cat/segments?v',
  '/_cat/tasks?v',
  '/_cat/templates?v',
  '/_cat/thread_pool?v',
  // _cluster
  '/_cluster/health',
  '/_cluster/health?pretty',
  '/_cluster/settings',
  '/_cluster/settings?include_defaults=true',
  '/_cluster/stats',
  '/_cluster/state',
  '/_cluster/pending_tasks',
  '/_cluster/allocation/explain',
  // _nodes
  '/_nodes',
  '/_nodes/stats',
  '/_nodes/info',
  '/_nodes/hot_threads',
  '/_nodes/stats/jvm,os,process',
  // _tasks
  '/_tasks',
  '/_tasks?actions=*&detailed',
  // ILM
  '/_ilm/policy',
  '/_ilm/status',
  '/_ilm/start',
  '/_ilm/stop',
  // templates
  '/_index_template',
  '/_component_template',
  // ingest
  '/_ingest/pipeline',
  // scripts
  '/_scripts',
  // search / query
  '/_search',
  '/_count',
  '/_field_caps',
  '/_msearch',
  '/_bulk',
  '/_reindex',
  '/_render/template',
  '/_validate/query',
  // snapshots
  '/_snapshot',
  '/_snapshot/_status',
  // routing
  '/_pit',
  // per-index
  '/{index}',
  '/{index}/_search',
  '/{index}/_count',
  '/{index}/_mapping',
  '/{index}/_settings',
  '/{index}/_stats',
  '/{index}/_doc/{id}',
  '/{index}/_bulk',
  '/{index}/_delete_by_query',
  '/{index}/_update_by_query',
  '/{index}/_refresh',
  '/{index}/_flush',
  '/{index}/_forcemerge',
  '/{index}/_open',
  '/{index}/_close',
  '/{index}/_alias',
  '/{index}/_aliases',
  '/{index}/_rollover',
  '/{index}/_shrink/{target}',
  '/{index}/_split/{target}',
  '/{index}/_clone/{target}',
  '/{index}/_ilm/explain',
]

// Common JSON body snippets for the request editor
const BODY_SNIPPETS: Record<string, string> = {
  'match_all': JSON.stringify({ query: { match_all: {} } }, null, 2),
  'match': JSON.stringify({ query: { match: { 'FIELD': 'VALUE' } } }, null, 2),
  'term': JSON.stringify({ query: { term: { 'FIELD.keyword': 'VALUE' } } }, null, 2),
  'terms': JSON.stringify({ query: { terms: { 'FIELD.keyword': ['V1', 'V2'] } } }, null, 2),
  'range': JSON.stringify({ query: { range: { 'FIELD': { gte: 'FROM', lte: 'TO' } } } }, null, 2),
  'bool': JSON.stringify({ query: { bool: { must: [], filter: [], should: [], must_not: [] } } }, null, 2),
  'aggs': JSON.stringify({ size: 0, aggs: { NAME: { terms: { field: 'FIELD.keyword', size: 10 } } } }, null, 2),
  'sort': JSON.stringify({ query: { match_all: {} }, sort: [{ 'FIELD': { order: 'desc' } }], size: 10 }, null, 2),
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'PATCH']

interface HistoryEntry {
  method: string
  path: string
  body: string
  timestamp: number
}

function statusColor(code: number): string {
  if (code >= 200 && code < 300) return 'green'
  if (code >= 300 && code < 400) return 'blue'
  if (code >= 400 && code < 500) return 'orange'
  return 'red'
}

function prettyJSON(raw: any): string {
  try {
    if (typeof raw === 'string') return raw
    return JSON.stringify(raw, null, 2)
  } catch {
    return String(raw)
  }
}

export default function ESDevConsole({ fixedClusterId }: { fixedClusterId?: number } = {}) {
  const [clusterId, setClusterId] = useState<number | undefined>(fixedClusterId)
  const [method, setMethod] = useState('GET')
  const [path, setPath] = useState('/_cluster/health')
  const [requestBody, setRequestBody] = useState('')
  const [responseText, setResponseText] = useState('')
  const [statusCode, setStatusCode] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)
  const [pathOptions, setPathOptions] = useState<{ value: string }[]>([])
  const [indexNames, setIndexNames] = useState<string[]>([])
  const monaco = useMonaco()
  const editorRef = useRef<any>(null)

  // Register completion provider for the request body editor
  useEffect(() => {
    if (!monaco) return
    const disposable = monaco.languages.registerCompletionItemProvider('json', {
      triggerCharacters: ['"', '{', ':'],
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        }
        const snippetItems = Object.entries(BODY_SNIPPETS).map(([label, value]) => ({
          label: `snippet: ${label}`,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: value,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: `Insert ${label} query template`,
          range,
        }))
        const esKeywords = [
          'query', 'bool', 'must', 'must_not', 'should', 'filter',
          'match', 'match_all', 'match_phrase', 'multi_match',
          'term', 'terms', 'range', 'exists', 'prefix', 'wildcard', 'regexp',
          'nested', 'has_child', 'has_parent',
          'aggs', 'aggregations', 'terms', 'date_histogram', 'histogram',
          'avg', 'sum', 'min', 'max', 'stats', 'cardinality', 'value_count',
          'sort', 'size', 'from', '_source', 'highlight', 'post_filter',
          'script', 'function_score', 'dis_max', 'constant_score',
        ].map(kw => ({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
          range,
        }))
        return { suggestions: [...snippetItems, ...esKeywords] }
      },
    })
    return () => disposable.dispose()
  }, [monaco])

  // Path auto-complete: filter common paths + index-based paths
  const handlePathSearch = (value: string) => {
    const all = [...COMMON_PATHS, ...indexNames.map(n => `/${n}`), ...indexNames.map(n => `/${n}/_search`), ...indexNames.map(n => `/${n}/_mapping`), ...indexNames.map(n => `/${n}/_settings`)]
    const filtered = all.filter(p => p.toLowerCase().includes(value.toLowerCase())).slice(0, 30)
    setPathOptions(filtered.map(p => ({ value: p })))
  }

  const handleSend = useCallback(async () => {
    if (!clusterId) { message.warning('Select a cluster first'); return }
    if (!path) { message.warning('Enter a path'); return }
    setLoading(true)
    setResponseText('')
    setStatusCode(null)
    const t0 = Date.now()
    try {
      const body = requestBody.trim()
      const res = await esDevConsole(clusterId, method, path, body || undefined)
      const elapsed = Date.now() - t0
      setElapsedMs(elapsed)
      setStatusCode(res.data.status_code)
      setResponseText(prettyJSON(res.data.body))
      setHistory(prev => [{ method, path, body, timestamp: Date.now() }, ...prev].slice(0, 50))
    } catch (e: any) {
      setElapsedMs(Date.now() - t0)
      setResponseText(e.response?.data?.error || e.message || 'Request failed')
      setStatusCode(e.response?.status || 0)
    }
    setLoading(false)
  }, [clusterId, method, path, requestBody])

  // Keyboard shortcut: Ctrl+Enter to send
  const handleEditorKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const handleEditorMount = (editor: any) => {
    editorRef.current = editor
    editor.getDomNode()?.addEventListener('keydown', handleEditorKeyDown)
  }

  const formatBody = () => {
    try {
      const parsed = JSON.parse(requestBody)
      setRequestBody(JSON.stringify(parsed, null, 2))
    } catch {
      message.error('Invalid JSON')
    }
  }

  const copyResponse = () => {
    navigator.clipboard.writeText(responseText)
    message.success('Copied')
  }

  const loadHistory = (entry: HistoryEntry) => {
    setMethod(entry.method)
    setPath(entry.path)
    setRequestBody(entry.body)
    setShowHistory(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', gap: 0 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', flexShrink: 0, flexWrap: 'wrap' }}>
        {!fixedClusterId && (
          <ClusterSelector
            value={clusterId}
            onChange={id => { setClusterId(id); setIndexNames([]) }}
            fetchClusters={listESClusters}
            placeholder="Select ES cluster"
          />
        )}
        <Select
          value={method}
          onChange={setMethod}
          style={{ width: 100 }}
          options={HTTP_METHODS.map(m => ({ value: m, label: m }))}
        />
        <AutoComplete
          value={path}
          onChange={setPath}
          onSearch={handlePathSearch}
          options={pathOptions}
          style={{ flex: 1, minWidth: 280 }}
          placeholder="/_cat/indices?v"
        >
          <input
            style={{
              width: '100%', height: 32, padding: '0 11px',
              border: '1px solid #d9d9d9', borderRadius: 6,
              fontFamily: 'monospace', fontSize: 13,
              outline: 'none',
            }}
          />
        </AutoComplete>
        <Button type="primary" icon={<SendOutlined />} loading={loading} onClick={handleSend}>
          Send <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 4 }}>Ctrl+↵</span>
        </Button>
        <Tooltip title="Format JSON body">
          <Button icon={<FormatPainterOutlined />} onClick={formatBody} />
        </Tooltip>
        <Tooltip title="Clear body">
          <Button icon={<DeleteOutlined />} onClick={() => setRequestBody('')} />
        </Tooltip>
        <Tooltip title="History">
          <Button icon={<HistoryOutlined />} onClick={() => setShowHistory(v => !v)} type={showHistory ? 'primary' : 'default'} />
        </Tooltip>
        {statusCode !== null && (
          <Space size={4}>
            <Tag color={statusColor(statusCode)}>{statusCode}</Tag>
            {elapsedMs !== null && <span style={{ fontSize: 12, color: '#888' }}>{elapsedMs}ms</span>}
          </Space>
        )}
      </div>

      {/* History panel */}
      {showHistory && history.length > 0 && (
        <div style={{
          background: '#f8f8f8', border: '1px solid #e8e8e8', borderRadius: 6,
          padding: '8px 12px', marginBottom: 8, maxHeight: 200, overflowY: 'auto', flexShrink: 0,
        }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Recent requests (click to restore)</div>
          {history.map((h, i) => (
            <div
              key={i}
              onClick={() => loadHistory(h)}
              style={{
                padding: '3px 6px', cursor: 'pointer', borderRadius: 4, fontSize: 13,
                fontFamily: 'monospace', display: 'flex', gap: 8, alignItems: 'center',
              }}
              className="history-item"
            >
              <Tag style={{ margin: 0, fontSize: 11 }}>{h.method}</Tag>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.path}</span>
              <span style={{ fontSize: 11, color: '#bbb', flexShrink: 0 }}>{new Date(h.timestamp).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}

      {/* Body snippets quick-insert */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4, flexShrink: 0 }}>
        <span style={{ fontSize: 12, color: '#888', lineHeight: '22px' }}>Snippets:</span>
        {Object.keys(BODY_SNIPPETS).map(k => (
          <Button
            key={k}
            size="small"
            style={{ fontSize: 11, height: 22, padding: '0 8px' }}
            onClick={() => setRequestBody(BODY_SNIPPETS[k])}
          >
            {k}
          </Button>
        ))}
      </div>

      {/* Split editor area */}
      <div style={{ display: 'flex', flex: 1, gap: 8, minHeight: 0 }}>
        {/* Request body editor */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{
            fontSize: 12, color: '#666', padding: '4px 8px',
            background: '#f5f5f5', border: '1px solid #e8e8e8',
            borderBottom: 'none', borderRadius: '6px 6px 0 0',
            display: 'flex', justifyContent: 'space-between',
          }}>
            <span>Request Body (JSON)</span>
            <span style={{ color: '#bbb' }}>Ctrl+Space for suggestions</span>
          </div>
          <div style={{ flex: 1, border: '1px solid #e8e8e8', borderRadius: '0 0 6px 6px', overflow: 'hidden' }}>
            <Editor
              height="100%"
              language="json"
              value={requestBody}
              onChange={v => setRequestBody(v || '')}
              onMount={handleEditorMount}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                wordWrap: 'on',
                suggestOnTriggerCharacters: true,
                quickSuggestions: true,
                folding: true,
                formatOnPaste: true,
                theme: 'vs',
              }}
            />
          </div>
        </div>

        <Divider type="vertical" style={{ height: 'auto', margin: 0 }} />

        {/* Response viewer */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{
            fontSize: 12, color: '#666', padding: '4px 8px',
            background: '#f5f5f5', border: '1px solid #e8e8e8',
            borderBottom: 'none', borderRadius: '6px 6px 0 0',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>Response</span>
            {responseText && (
              <Tooltip title="Copy response">
                <Button size="small" icon={<CopyOutlined />} type="text" onClick={copyResponse} />
              </Tooltip>
            )}
          </div>
          <div style={{ flex: 1, border: '1px solid #e8e8e8', borderRadius: '0 0 6px 6px', overflow: 'hidden' }}>
            <Editor
              height="100%"
              language="json"
              value={responseText}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                wordWrap: 'on',
                folding: true,
                theme: 'vs',
              }}
            />
          </div>
        </div>
      </div>

      <style>{`
        .history-item:hover { background: #e8f4fd; }
      `}</style>
    </div>
  )
}
