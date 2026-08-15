import React from 'react'
import { Modal, Button, Typography, message } from 'antd'
import { CopyOutlined } from '@ant-design/icons'

/**
 * 导入失败时, 单独展示缺失物料列表, 支持一键复制, 便于用户去物料表修复.
 * 由后端返回的 missingParts 驱动.
 */
export default function MissingPartsModal({ open, missingParts = [], onClose }) {
  const handleCopy = async () => {
    if (!missingParts.length) return
    try {
      await navigator.clipboard.writeText(missingParts.join('\n'))
      message.success(`已复制 ${missingParts.length} 个缺失物料`)
    } catch (e) {
      message.error('复制失败，请手动复制')
    }
  }

  return (
    <Modal
      title="以下物料不存在"
      open={open}
      onCancel={onClose}
      width={500}
      footer={[
        <Button key="close" onClick={onClose}>关闭</Button>,
        <Button key="copy" type="primary" icon={<CopyOutlined />} onClick={handleCopy}>复制全部物料</Button>,
      ]}
    >
      <Typography.Paragraph type="secondary">
        以下物料未在物料主档中，请先在「物料管理」导入/创建后再重新导入：
      </Typography.Paragraph>
      <div
        style={{
          maxHeight: 320,
          overflow: 'auto',
          border: '1px solid #f0f0f0',
          borderRadius: 8,
          padding: '8px 12px',
          background: '#fafafa',
        }}
      >
        {missingParts.length === 0 ? (
          <Typography.Text type="secondary">无缺失物料</Typography.Text>
        ) : (
          missingParts.map((m, i) => (
            <div
              key={i}
              style={{
                padding: '5px 0',
                fontFamily: 'monospace',
                fontSize: 13,
                borderBottom: i < missingParts.length - 1 ? '1px solid #f0f0f0' : 'none',
              }}
            >
              {m}
            </div>
          ))
        )}
      </div>
    </Modal>
  )
}