import { useEffect, useRef } from 'react'
import PropTypes from 'prop-types'
import { Button } from 'antd'
import { CodeOutlined, CloseOutlined } from '@ant-design/icons'
import Convert from 'ansi-to-html'

const converter = new Convert({ fg: '#ccc', bg: '#000', newline: false, escapeXML: true })

function classifyCodeAnalysisLine(line) {
  if (!line.startsWith('[CodeAnalysis]')) return null

  if (
    line.includes('失败') ||
    line.includes('异常') ||
    line.includes('空 response') ||
    line.includes('非成功返回')
  ) {
    return {
      tone: 'error',
      label: '错误',
      background: 'rgba(255, 77, 79, 0.12)',
      borderColor: 'rgba(255, 77, 79, 0.28)',
      color: '#ffccc7'
    }
  }

  if (
    line.includes('兜底') ||
    line.includes('plan_generated') ||
    line.includes('开始调用 /chat/execute')
  ) {
    return {
      tone: 'warning',
      label: '警告',
      background: 'rgba(250, 173, 20, 0.12)',
      borderColor: 'rgba(250, 173, 20, 0.28)',
      color: '#ffe58f'
    }
  }

  return {
    tone: 'info',
    label: '分析',
    background: 'rgba(22, 119, 255, 0.10)',
    borderColor: 'rgba(22, 119, 255, 0.24)',
    color: '#bae0ff'
  }
}

function renderLogLine(line, index) {
  const kind = classifyCodeAnalysisLine(line)
  const html = converter.toHtml(line || ' ')

  if (!kind) {
    return (
      <div
        key={`log-line-${index}`}
        dangerouslySetInnerHTML={{ __html: html || '&nbsp;' }}
      />
    )
  }

  return (
    <div
      key={`log-line-${index}`}
      style={{
        marginBottom: 4,
        padding: '6px 8px',
        borderRadius: 8,
        background: kind.background,
        border: `1px solid ${kind.borderColor}`
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{
          fontSize: 11,
          lineHeight: 1,
          padding: '2px 6px',
          borderRadius: 999,
          background: kind.borderColor,
          color: kind.color
        }}>
          {kind.label}
        </span>
      </div>
      <div
        style={{ color: kind.color }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}

export default function LogPanel({ isOpen, onClose, localTerminalOutput }) {
  const terminalBottomRef = useRef(null)
  const logLines = (localTerminalOutput || '').split('\n')

  useEffect(() => {
    terminalBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [localTerminalOutput])

  if (!isOpen) return null

  return (
    <div className="ab-log-panel" style={{
      width: 320, minWidth: 280, maxWidth: 400, display: 'flex', flexDirection: 'column',
      background: '#111', borderLeft: '1px solid #1f1f1f', height: '100%',
      position: 'absolute', right: 0, top: 0, bottom: 0, zIndex: 100,
      boxShadow: '-4px 0 16px rgba(0,0,0,0.5)'
    }}>
      <div style={{
        padding: '8px 10px', background: '#0d0d0d', borderBottom: '1px solid #1f1f1f',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <span style={{ color: '#ccc', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          <CodeOutlined /> Terminal
        </span>
        <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} style={{ color: '#888' }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100% - 37px)' }}>
        <div style={{
          flex: 1, overflow: 'auto', padding: '8px 10px', background: '#0a0a0a',
          fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap', color: '#ccc'
        }}
          className="custom-scrollbar"
        >
          {localTerminalOutput
            ? <div>{logLines.map((line, index) => renderLogLine(line, index))}</div>
            : <span style={{ color: '#444' }}>No active terminal session...</span>
          }
          <div ref={terminalBottomRef} />
        </div>
      </div>
    </div>
  )
}

LogPanel.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  localTerminalOutput: PropTypes.string
}
