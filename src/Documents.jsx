import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Layout, Table, Button, Upload, message, Switch, Popconfirm, Tag, Space, Modal, Typography, Select, Spin } from 'antd'
import { UploadOutlined, DeleteOutlined, FilePdfOutlined, FileWordOutlined, FileExcelOutlined, FileImageOutlined, FileTextOutlined, DownloadOutlined, CodeOutlined, FileUnknownOutlined, ToolOutlined, ReloadOutlined } from '@ant-design/icons'
import api, { getAuthHeaders, getBackendHost, getWsBaseUrl } from './auth'
import dayjs from 'dayjs'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import { useUIStore } from './store/useUIStore'
import { isSuperAdmin as isSuperAdminFn, isCompanyAdmin as isCompanyAdminFn } from './utils/permissions.js';

const { Content } = Layout
const { Title } = Typography

// All types accepted by the upload button
const ACCEPTED_TYPES = [
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.md', '.csv',
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg',
    '.dxf', '.dwg', '.step', '.stp', '.iges', '.igs',
    '.xml', '.html', '.htm', '.json', '.yaml', '.yml',
    '.toml', '.ini', '.properties',
    '.py', '.js', '.ts', '.sh', '.bat',
].join(',')

const getFileIcon = (fileType) => {
    const ft = fileType?.toLowerCase()
    switch (ft) {
        case 'pdf':  return <FilePdfOutlined style={{ color: '#cf1322' }} />
        case 'doc':
        case 'docx': return <FileWordOutlined style={{ color: '#1677ff' }} />
        case 'xls':
        case 'xlsx': return <FileExcelOutlined style={{ color: '#389e0d' }} />
        case 'jpg': case 'jpeg': case 'png':
        case 'gif':  case 'webp': case 'bmp': case 'svg':
                     return <FileImageOutlined style={{ color: '#13c2c2' }} />
        case 'xml': case 'html': case 'htm':
        case 'json': case 'yaml': case 'yml':
        case 'py':  case 'js':   case 'ts':
        case 'sh':  case 'bat':  case 'toml':
        case 'ini': case 'properties':
                     return <CodeOutlined style={{ color: '#fa8c16' }} />
        case 'dxf': case 'dwg': case 'step': case 'stp': case 'iges': case 'igs':
                     return <ToolOutlined style={{ color: '#722ed1' }} />
        case 'txt': case 'md': case 'csv': case 'log':
                     return <FileTextOutlined style={{ color: '#8c8c8c' }} />
        default:     return <FileUnknownOutlined style={{ color: '#8c8c8c' }} />
    }
}

const Documents = ({ user, companies = [], users = [] }) => {
    const { t } = useTranslation()
    const { setCurrentDoc, setPreviewOpen: setAppPreviewOpen } = useUIStore()
    const [documents, setDocuments] = useState([])
    const [loading, setLoading] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [previewOpen, setPreviewOpen] = useState(false)
    const [previewUrl, setPreviewUrl] = useState(null)
    const [previewName, setPreviewName] = useState(null)
    const [previewType, setPreviewType] = useState('iframe')
    const [previewHtml, setPreviewHtml] = useState('')
    const [previewText, setPreviewText] = useState('')
    const [previewLoading, setPreviewLoading] = useState(false)
    
    const [selectedCompanyId, setSelectedCompanyId] = useState('all')
    const [selectedUserId, setSelectedUserId] = useState('all')

    const isSuperAdmin = isSuperAdminFn(user)
    const isCompanyAdmin = isCompanyAdminFn(user)

    const fetchDocuments = async (showLoading = true) => {
        if (showLoading) setLoading(true)
        try {
            const host = getBackendHost()
            const params = new URLSearchParams()
            if (selectedCompanyId && selectedCompanyId !== 'all') params.append('companyId', selectedCompanyId)
            if (selectedUserId && selectedUserId !== 'all') params.append('userId', selectedUserId)

            const res = await api.get('/documents/company?' + params.toString(), { 
                headers: getAuthHeaders(),
                baseURL: host.startsWith('http') ? `${host}/api` : `http://${host}/api`
            })
            if (res.data.status === 'success') {
                setDocuments(res.data.data)
            }
        } catch (error) {
            if (showLoading) message.error('Failed to fetch documents')
        } finally {
            if (showLoading) setLoading(false)
        }
    }

    useEffect(() => {
        fetchDocuments()
    }, [selectedCompanyId, selectedUserId])

    // WebSocket push — replaces polling. Backend pushes DOCUMENT_UPDATED
    // when a document finishes parsing; frontend refreshes immediately.
    const wsRef = useRef(null)
    const mountedRef = useRef(true)
    useEffect(() => {
        mountedRef.current = true
        const token = localStorage.getItem('token')
        if (!token) return
        try {
            const wsBase = getWsBaseUrl()
            const wsUrl = `${wsBase}/ws/logs?session_id=docs-watcher&token=${encodeURIComponent(token)}`
            let ws = new WebSocket(wsUrl)
            wsRef.current = ws

            ws.onopen = () => console.log('[DocsWS] Connected')
            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data)
                    if (msg.type === 'DOCUMENT_UPDATED') {
                        const { documentId, status, progress, message: phaseMsg } = msg
                        if (status === 'COMPLETED' || status === 'FAILED') {
                            fetchDocuments(false)
                        } else {
                            setDocuments(prev => prev.map(doc =>
                                doc.id === documentId
                                    ? { ...doc, status, parsingProgress: progress, phaseMessage: phaseMsg }
                                    : doc
                            ))
                        }
                    }
                } catch (e) {
                    // ignore parse errors from non-document messages
                }
            }
            ws.onclose = (ev) => {
                if (!mountedRef.current) return
                console.warn('[DocsWS] Disconnected (code=%d), reconnecting in 3s...', ev.code)
                wsRef.current = null
                let delay = 3000
                const reconnect = () => {
                    if (!mountedRef.current) return
                    try {
                        const w = new WebSocket(wsUrl)
                        wsRef.current = w
                        w.onopen = () => console.log('[DocsWS] Reconnected')
                        w.onmessage = ws.onmessage
                        w.onerror = () => {}
                        w.onclose = (ev2) => {
                            if (wsRef.current === w) wsRef.current = null
                            if (!mountedRef.current) return
                            delay = Math.min(delay * 2, 30000)
                            console.warn('[DocsWS] Reconnect in %dms', delay)
                            setTimeout(reconnect, delay)
                        }
                    } catch (e) {
                        console.error('[DocsWS] Reconnect failed:', e)
                        if (mountedRef.current) setTimeout(reconnect, Math.min(delay * 2, 30000))
                    }
                }
                setTimeout(reconnect, delay)
            }
            ws.onerror = (e) => {
                console.error('[DocsWS] Error:', e)
            }

            return () => {
                mountedRef.current = false
                const cur = wsRef.current
                if (cur) { try { cur.close() } catch (e) {} }
                wsRef.current = null
            }
        } catch (e) {
            console.error('[DocsWS] Connection failed:', e)
        }
    }, [])

    const handleUpload = async (options) => {
        const { file, onSuccess, onError } = options;
        const formData = new FormData();
        formData.append('file', file);
        setUploading(true)
        try {
            const host = getBackendHost()
            const res = await api.post('/documents/upload', formData, {
                headers: {
                    ...getAuthHeaders(),
                    'Content-Type': 'multipart/form-data'
                },
                baseURL: host.startsWith('http') ? `${host}/api` : `http://${host}/api`
            });
            if (res.data.status === 'success') {
                message.success(`${file.name} uploaded successfully`);
                onSuccess("Ok");
                fetchDocuments();
            } else {
                message.error(`Upload failed: ${res.data.message}`);
                onError(new Error('Upload failed'));
            }
        } catch (error) {
            const errMsg = error?.response?.data?.message || error?.message || 'Upload failed';
            message.error(errMsg);
            onError(error);
        } finally {
            setUploading(false)
        }
    }

    const handleTogglePublic = async (id, checked) => {
        try {
            const host = getBackendHost()
            const res = await api.put(`/documents/${id}/public`, { isPublic: checked }, { 
                headers: getAuthHeaders(),
                baseURL: host.startsWith('http') ? `${host}/api` : `http://${host}/api`
            })
            if (res.data.status === 'success') {
                message.success('Visibility updated')
                setDocuments(prev => prev.map(doc => doc.id === id ? { ...doc, isPublic: checked } : doc))
            } else {
                message.error(res.data.message)
            }
        } catch (error) {
            message.error('Failed to update visibility')
        }
    }

    const handleDelete = async (id) => {
        try {
            const host = getBackendHost()
            const res = await api.delete(`/documents/${id}`, { 
                headers: getAuthHeaders(),
                baseURL: host.startsWith('http') ? `${host}/api` : `http://${host}/api`
            })
            if (res.data.status === 'success') {
                message.success('Document deleted')
                setDocuments(prev => prev.filter(doc => doc.id !== id))
            } else {
                message.error(res.data.message)
            }
        } catch (error) {
            message.error('Failed to delete document')
        }
    }

    const handleReparse = async (id) => {
        try {
            const host = getBackendHost()
            const res = await api.post(`/documents/${id}/reparse`, null, {
                headers: getAuthHeaders(),
                baseURL: host.startsWith('http') ? `${host}/api` : `http://${host}/api`
            })
            if (res.data.status === 'ok') {
                message.success(res.data.message || 'Re-parse triggered')
            } else {
                message.error(res.data.error || 'Failed to re-parse')
            }
        } catch (error) {
            message.error('Failed to re-parse')
        }
    }

    const handleDownload = async (doc) => {
        try {
            const host = getBackendHost()
            const baseURL = host.startsWith('http') ? host : `http://${host}`
            const res = await api.get(`/documents/${doc.id}/download`, {
                headers: getAuthHeaders(),
                baseURL: `${baseURL}/api`,
                responseType: 'blob'
            })
            const url = URL.createObjectURL(res.data)
            const a = document.createElement('a')
            a.href = url
            a.download = doc.filename || `${doc.id}.${doc.fileType || 'bin'}`
            a.click()
            URL.revokeObjectURL(url)
        } catch {
            message.error('Failed to download document')
        }
    }

    const openPreview = async (doc) => {
        const fileType = (doc.fileType || doc.filename?.split('.').pop() || '').toLowerCase()

        // Legacy .doc: browser can't render it — show download prompt instead
        if (fileType === 'doc') {
            Modal.confirm({
                title: (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <FileWordOutlined style={{ color: '#2b579a' }} />
                        {t('documents.legacyDocTitle')}
                    </span>
                ),
                content: (
                    <div style={{ lineHeight: 1.7 }}>
                        <p style={{ margin: '0 0 8px' }}>
                            {t('documents.legacyDocWarning', { filename: doc.filename })}
                        </p>
                        <p style={{ margin: 0, color: '#888', fontSize: 13 }}>
                            {t('documents.legacyDocHint')}
                        </p>
                    </div>
                ),
                okText: t('documents.download'),
                okButtonProps: { icon: <DownloadOutlined /> },
                cancelText: t('common.cancel'),
                onOk: async () => {
                    try {
                        const host = getBackendHost()
                        const baseURL = host.startsWith('http') ? host : `http://${host}`
                        const res = await api.get(`/documents/${doc.id}/download`, {
                            headers: getAuthHeaders(),
                            baseURL: `${baseURL}/api`,
                            responseType: 'blob'
                        })
                        const url = URL.createObjectURL(res.data)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = doc.filename || `${doc.id}.doc`
                        a.click()
                        URL.revokeObjectURL(url)
                    } catch {
                        message.error(t('common.error'))
                    }
                },
            })
            return
        }

        try {
            setPreviewName(doc.filename || doc.id)
            setPreviewOpen(true)
            setPreviewLoading(true)

            const host = getBackendHost()
            const baseURL = host.startsWith('http') ? host : `http://${host}`
            const res = await api.get(`/documents/${doc.id}/download`, {
                headers: getAuthHeaders(),
                baseURL: `${baseURL}/api`,
                responseType: 'blob'
            })
            const blob = res.data
            if (fileType === 'docx') {
                const arrayBuffer = await blob.arrayBuffer()
                const result = await mammoth.convertToHtml({ arrayBuffer })
                setPreviewType('html')
                setPreviewHtml(result.value || '')
                setPreviewUrl(null)
                setPreviewText('')
            } else if (fileType === 'xlsx' || fileType === 'xls') {
                const arrayBuffer = await blob.arrayBuffer()
                const workbook = XLSX.read(arrayBuffer, { type: 'array' })
                const firstSheetName = workbook.SheetNames[0]
                const worksheet = workbook.Sheets[firstSheetName]
                const htmlString = XLSX.utils.sheet_to_html(worksheet)
                setPreviewType('html')
                setPreviewHtml(`<div style="padding: 16px; background: white; color: black; min-height: 100%;"><style>table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #ddd; padding: 8px; }</style>${htmlString}</div>`)
                setPreviewUrl(null)
                setPreviewText('')
            } else if (['txt', 'md', 'csv', 'json', 'log'].includes(fileType)) {
                const txt = await blob.text()
                setPreviewType('text')
                setPreviewText(txt)
                setPreviewUrl(null)
                setPreviewHtml('')
            } else {
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

    const openGlobalPreview = (record) => {
        setCurrentDoc({
            id: record.id,
            filename: record.filename,
            fileType: record.fileType
        })
        setAppPreviewOpen(true)
    }

    const columns = [
        {
            title: 'File Name',
            dataIndex: 'filename',
            key: 'filename',
            render: (text, record) => (
                <Space>
                    {getFileIcon(record.fileType)}
                    <Typography.Text 
                        style={{ cursor: 'pointer', color: '#1677ff' }}
                        onClick={() => openGlobalPreview(record)}
                        strong
                    >
                        {text}
                    </Typography.Text>
                </Space>
            )
        },
        {
            title: 'Size',
            dataIndex: 'fileSize',
            key: 'fileSize',
            render: (size) => (size / 1024 / 1024).toFixed(2) + ' MB'
        },
        {
            title: 'Status',
            dataIndex: 'status',
            key: 'status',
            render: (status, record) => {
                let color = 'default';
                let text = status;
                if (status === 'COMPLETED') color = 'success';
                if (status === 'PARSING') {
                    color = 'processing';
                    const pct = record.parsingProgress || 0;
                    const phase = record.phaseMessage || '';
                    text = phase ? `${phase} ${pct}%` : `PARSING (${pct}%)`;
                }
                if (status === 'FAILED') color = 'error';
                return <Tag color={color}>{text}</Tag>
            }
        },
        {
            title: 'Public to Company',
            dataIndex: 'isPublic',
            key: 'isPublic',
            render: (isPublic, record) => (
                <Switch 
                    checked={isPublic} 
                    onChange={(checked) => handleTogglePublic(record.id, checked)}
                    checkedChildren="Public"
                    unCheckedChildren="Private"
                />
            )
        },
        {
            title: 'Uploaded At',
            dataIndex: 'createdAt',
            key: 'createdAt',
            render: (date) => dayjs(date).format('YYYY-MM-DD HH:mm:ss')
        },
        {
            title: 'Action',
            key: 'action',
            render: (_, record) => (
                <Space>
                    <Button type="text" icon={<DownloadOutlined />} 
                        title="Download"
                        onClick={() => handleDownload(record)} />
                    <Popconfirm
                        title="Re-parse document"
                        description="Delete ES/knowledge graph data and re-parse from file?"
                        onConfirm={() => handleReparse(record.id)}
                        okText="Yes"
                        cancelText="No"
                    >
                        <Button type="text" icon={<ReloadOutlined style={{ color: '#1677ff' }} />} 
                            title="Re-parse" />
                    </Popconfirm>
                    <Popconfirm
                        title="Delete the document"
                        description="Are you sure to delete this document?"
                        onConfirm={() => handleDelete(record.id)}
                        okText="Yes"
                        cancelText="No"
                    >
                        <Button type="text" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                </Space>
            )
        }
    ]

    return (
        <Content style={{ padding: 24, margin: 0, minHeight: 280, background: '#1e1e1e', borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Space size="large">
                    <Title level={4} style={{ color: '#fff', margin: 0 }}>Company Documents</Title>
                    {isSuperAdmin && (
                        <Select
                            value={selectedCompanyId}
                            onChange={(val) => {
                                setSelectedCompanyId(val)
                                setSelectedUserId('all') // reset user filter when company changes
                            }}
                            style={{ width: 200 }}
                            options={[
                                { value: 'all', label: 'All Companies' },
                                ...companies.map(c => ({ value: c.id, label: c.name }))
                            ]}
                        />
                    )}
                    {(isSuperAdmin || isCompanyAdmin) && (
                        <Select
                            value={selectedUserId}
                            onChange={setSelectedUserId}
                            style={{ width: 200 }}
                            options={[
                                { value: 'all', label: 'All Users' },
                                ...users
                                    .filter(u => selectedCompanyId === 'all' || u.companyId === selectedCompanyId || (isCompanyAdmin && u.companyId === user?.companyId))
                                    .map(u => ({ value: u.id, label: u.username }))
                            ]}
                        />
                    )}
                </Space>
                <Upload customRequest={handleUpload} showUploadList={false} accept={ACCEPTED_TYPES}>
                    <Button type="primary" icon={<UploadOutlined />} loading={uploading}>
                        Upload Document
                    </Button>
                </Upload>
            </div>
            
            <Table 
                columns={columns} 
                dataSource={documents} 
                rowKey="id"
                loading={loading}
                pagination={{ pageSize: 10 }}
            />

            <Modal
                title={previewName || 'Preview'}
                open={previewOpen}
                onCancel={() => {
                    setPreviewOpen(false)
                    if (previewUrl) URL.revokeObjectURL(previewUrl)
                    setPreviewUrl(null)
                    setPreviewName(null)
                    setPreviewHtml('')
                    setPreviewText('')
                    setPreviewLoading(false)
                }}
                footer={null}
                width="80vw"
                styles={{
                    body: { height: '70vh', background: '#141414', color: '#f0f0f0', position: 'relative' },
                    content: { background: '#141414' },
                    header: { background: '#141414', borderBottom: '1px solid #2a2a2a' }
                }}
            >
                {previewLoading ? (
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'rgba(20, 20, 20, 0.8)', zIndex: 10 }}>
                        <Spin size="large" tip="Loading document..." />
                    </div>
                ) : null}
                {previewType === 'iframe' && previewUrl ? (
                    <iframe title="doc-preview" src={previewUrl} style={{ width: '100%', height: '100%', border: 0, background: '#141414' }} />
                ) : null}
                {previewType === 'html' ? (
                    <div style={{ height: '100%', overflow: 'auto', color: '#f0f0f0' }} dangerouslySetInnerHTML={{ __html: previewHtml }} />
                ) : null}
                {previewType === 'text' ? (
                    <pre style={{ height: '100%', overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap', color: '#f0f0f0', background: '#141414' }}>
                        {previewText}
                    </pre>
                ) : null}
            </Modal>
        </Content>
    )
}

export default Documents
