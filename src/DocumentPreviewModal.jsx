import React, { useState, useEffect } from 'react'
import { Modal, Spin, message, Table, Button } from 'antd'
import { DownloadOutlined, FileWordOutlined } from '@ant-design/icons'
import api from './auth'
import DocumentParserWorker from './workers/documentParser.worker?worker'
import { useUIStore } from './store/useUIStore'

// File types rendered as a plain/code text block
const CODE_TYPES = new Set([
  'xml', 'html', 'htm', 'json', 'yaml', 'yml',
  'toml', 'ini', 'properties',
  'py', 'js', 'ts', 'sh', 'bat',
  'txt', 'md', 'csv', 'log',
])

// File types rendered as <img>
const IMAGE_TYPES = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'])

export default function DocumentPreviewModal() {
  const { currentDoc: doc, previewOpen: open, setPreviewOpen, setCurrentDoc } = useUIStore()
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewType, setPreviewType] = useState('iframe')
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewText, setPreviewText] = useState('')
  const [previewTable, setPreviewTable] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [legacyDoc, setLegacyDoc] = useState(null)

  useEffect(() => {
    if (open && doc) {
      const fileType = (doc.fileType || doc.filename?.split('.').pop() || '').toLowerCase()
      if (fileType === 'doc') {
        setLegacyDoc(doc)
      } else {
        setLegacyDoc(null)
        openPreview(doc)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doc])

  const onCancel = () => {
    setPreviewOpen(false)
    setTimeout(() => {
      setCurrentDoc(null)
      setPreviewHtml('')
      setPreviewText('')
      setPreviewTable(null)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
      setLegacyDoc(null)
    }, 300)
  }

  const handleLegacyDownload = async () => {
    if (!legacyDoc) return
    try {
      const res = await api.get(`/documents/${legacyDoc.id}/download`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = legacyDoc.filename || `${legacyDoc.id}.doc`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      message.error('Download failed')
    }
    onCancel()
  }

  const openPreview = async (document) => {
    try {
      setPreviewLoading(true)
      // Reset previous state
      setPreviewHtml('')
      setPreviewText('')
      setPreviewTable(null)
      setPreviewUrl(null)

      const res = await api.get(`/documents/${document.id}/download`, { responseType: 'blob' })
      const fileType = (document.fileType || document.filename?.split('.').pop() || '').toLowerCase()
      const blob = res.data

      if (['docx', 'xlsx', 'xls'].includes(fileType)) {
        // Offload heavy parsing to Web Worker
        const arrayBuffer = await blob.arrayBuffer()
        const worker = new DocumentParserWorker()
        worker.onmessage = (e) => {
          const { success, html, error, columns, data } = e.data
          if (success) {
            if (fileType.startsWith('xls')) {
              setPreviewType('table')
              setPreviewTable({ columns, data })
              setPreviewHtml('')
            } else {
              setPreviewType('html')
              setPreviewHtml(html)
              setPreviewTable(null)
            }
            setPreviewUrl(null)
            setPreviewText('')
          } else {
            message.error('Parsing failed: ' + error)
          }
          worker.terminate()
          setPreviewLoading(false)
        }
        worker.onerror = (err) => {
          message.error('Worker error: ' + err.message)
          worker.terminate()
          setPreviewLoading(false)
        }
        worker.postMessage({ fileType, arrayBuffer })
        return // loading cleared by worker callback

      } else if (IMAGE_TYPES.has(fileType)) {
        // Render as image
        const url = URL.createObjectURL(blob)
        setPreviewType('image')
        setPreviewUrl(url)
        setPreviewHtml('')
        setPreviewText('')

      } else if (CODE_TYPES.has(fileType)) {
        // Render as plain/code text
        const txt = await blob.text()
        setPreviewType('text')
        setPreviewText(txt)
        setPreviewUrl(null)
        setPreviewHtml('')

      } else {
        // PDF and anything else: browser iframe
        const url = URL.createObjectURL(blob)
        setPreviewType('iframe')
        setPreviewUrl(url)
        setPreviewHtml('')
        setPreviewText('')
      }
    } catch (e) {
      message.error('Failed to preview document')
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleCancel = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setPreviewHtml('')
    setPreviewText('')
    setPreviewTable(null)
    setPreviewLoading(false)
    onCancel()
  }

  return (
    <>
      {/* Legacy .doc warning modal */}
      <Modal
        open={open && !!legacyDoc}
        onCancel={onCancel}
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileWordOutlined style={{ color: '#2b579a' }} />
            无法预览旧版 Word 文档
          </span>
        }
        footer={[
          <Button key="cancel" onClick={onCancel}>取消</Button>,
          <Button key="download" type="primary" icon={<DownloadOutlined />} onClick={handleLegacyDownload}>
            下载到本地
          </Button>,
        ]}
        width={420}
      >
        <div style={{ padding: '8px 0', color: '#ccc', lineHeight: 1.7 }}>
          <p style={{ margin: '0 0 8px' }}>
            文件 <strong style={{ color: '#fff' }}>{legacyDoc?.filename}</strong> 是旧版{' '}
            <code>.doc</code> 格式，浏览器无法直接渲染。
          </p>
          <p style={{ margin: 0, color: '#888', fontSize: 13 }}>
            请下载到本地后使用 Microsoft Word 或 WPS 打开。
          </p>
        </div>
      </Modal>

      {/* Normal preview modal */}
      <Modal
        title={doc?.filename || doc?.id || 'Preview'}
        open={open && !legacyDoc}
        onCancel={handleCancel}
        footer={null}
        width="80vw"
        styles={{
          body: { height: '70vh', position: 'relative', overflow: 'hidden' },
        }}
      >
        {previewLoading && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            background: 'rgba(0,0,0,0.4)', zIndex: 10,
          }}>
            <Spin size="large" tip="Loading..." />
          </div>
        )}

        {/* PDF / fallback */}
        {previewType === 'iframe' && previewUrl && (
          <iframe
            title="doc-preview"
            src={previewUrl}
            style={{ width: '100%', height: '100%', border: 0 }}
          />
        )}

        {/* DOCX rendered HTML */}
        {previewType === 'html' && (
          <div
            style={{ height: '100%', overflow: 'auto' }}
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        )}

        {/* Plain text / code / XML / JSON */}
        {previewType === 'text' && (
          <pre style={{
            height: '100%', overflow: 'auto', margin: 0,
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            fontFamily: '"Fira Code", "Cascadia Code", Consolas, monospace',
            fontSize: 13, lineHeight: 1.6,
            padding: '12px 16px',
            background: '#0d1117', color: '#e6edf3',
            borderRadius: 4,
          }}>
            {previewText}
          </pre>
        )}

        {/* XLSX / XLS virtual table */}
        {previewType === 'table' && previewTable && (
          <Table
            columns={previewTable.columns}
            dataSource={previewTable.data}
            pagination={false}
            scroll={{ y: 'calc(70vh - 40px)', x: 'max-content' }}
            virtual
            size="small"
            bordered
          />
        )}

        {/* Image preview */}
        {previewType === 'image' && previewUrl && (
          <div style={{
            height: '100%', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            overflow: 'auto', background: '#141414',
          }}>
            <img
              src={previewUrl}
              alt={doc?.filename || 'preview'}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            />
          </div>
        )}
      </Modal>
    </>
  )
}
