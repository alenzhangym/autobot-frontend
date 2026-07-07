import { useState, useEffect } from 'react'
import { Dropdown, Tooltip } from 'antd'
import { BgColorsOutlined, CheckOutlined } from '@ant-design/icons'
import { THEMES, getThemeId, setTheme } from '../themes'

/**
 * Theme switcher dropdown — works both on Home (pre-login) and in App (post-login).
 * Uses CSS-variable overrides so all pages reflect the choice instantly.
 */
export default function ThemeSwitcher({ size = 'default', showLabel = false }) {
  const [current, setCurrent] = useState(getThemeId())

  useEffect(() => {
    const handler = (e) => setCurrent(e.detail)
    window.addEventListener('theme-change', handler)
    return () => window.removeEventListener('theme-change', handler)
  }, [])

  const menuItems = Object.values(THEMES).map((t) => ({
    key: t.id,
    label: (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        minWidth: 180,
        gap: 12,
      }}>
        <div>
          <div style={{ fontWeight: 500, fontSize: 13 }}>{t.label}</div>
          <div style={{ fontSize: 11, color: 'var(--ab-text-3)' }}>{t.description}</div>
        </div>
        <div style={{
          width: 14,
          height: 14,
          borderRadius: 3,
          border: '1px solid var(--ab-line)',
          background: t.vars['--ab-copper'],
          flexShrink: 0,
        }} />
        {current === t.id && (
          <CheckOutlined style={{ color: 'var(--ab-copper)', fontSize: 12 }} />
        )}
      </div>
    ),
  }))

  return (
    <Dropdown
      menu={{ items: menuItems, onClick: ({ key }) => setTheme(key) }}
      trigger={['click']}
      placement="bottomRight"
    >
      <Tooltip title="Theme">
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          fontSize: size === 'small' ? 12 : 13,
          fontFamily: 'var(--ab-font-mono)',
          letterSpacing: '0.05em',
          color: 'var(--ab-text-2)',
          padding: '4px 8px',
          borderRadius: 3,
          transition: 'color 0.2s',
        }}
        >
          <BgColorsOutlined style={{ fontSize: size === 'small' ? 14 : 16 }} />
          {showLabel && THEMES[current]?.label}
        </span>
      </Tooltip>
    </Dropdown>
  )
}
