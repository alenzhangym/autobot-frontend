/**
 * AutoBot Theme System
 *
 * Themes are applied by overriding CSS variables on :root
 * + providing matching Ant Design ConfigProvider tokens.
 */

export const THEMES = {
  atelier: {
    id: 'atelier',
    label: 'Atelier Dark',
    description: 'Deep obsidian + copper',
    isDark: true,
    vars: {
      '--ab-bg':           '#0a0a0a',
      '--ab-bg-1':         '#0e0e0e',
      '--ab-bg-2':         '#121212',
      '--ab-bg-3':         '#161616',
      '--ab-surface':      '#181613',
      '--ab-surface-2':    '#1f1c18',
      '--ab-line':         '#2a2620',
      '--ab-line-soft':    'rgba(212, 165, 116, 0.14)',
      '--ab-line-bold':    'rgba(212, 165, 116, 0.32)',
      '--ab-text':         '#e8e3d8',
      '--ab-text-2':       '#b8b1a3',
      '--ab-text-3':       '#807a6e',
      '--ab-text-4':       '#524d44',
      '--ab-copper':       '#d4a574',
      '--ab-copper-2':     '#c89770',
      '--ab-copper-hi':    '#e8b886',
      '--ab-copper-glow':  'rgba(212, 165, 116, 0.18)',
      '--ab-teal':         '#5a9a96',
      '--ab-teal-hi':      '#7ab5b0',
      '--ab-rose':         '#c97a6b',
      '--ab-moss':         '#8a9a6e',
      '--ab-iris':         '#8a7aa8',
      '--ab-shadow-1':     '0 1px 0 rgba(255, 235, 200, 0.02) inset',
      '--ab-shadow-2':     '0 8px 32px rgba(0, 0, 0, 0.55), 0 1px 0 rgba(212, 165, 116, 0.04) inset',
      '--ab-shadow-glow':  '0 0 24px rgba(212, 165, 116, 0.12)',
    },
    ant: {
      algorithm: 'dark',
      token: {
        colorPrimary: '#d4a574',
        borderRadius: 3,
        colorBgContainer: '#0e0e0e',
        colorBgElevated: '#181613',
        colorBorder: '#2a2620',
        colorText: '#e8e3d8',
        colorTextSecondary: '#b8b1a3',
        colorTextTertiary: '#807a6e',
        fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
      },
      components: {
        Layout: { siderBg: '#0e0e0e', headerBg: '#0e0e0e', bodyBg: '#0a0a0a' },
        Menu: {
          darkItemBg: '#0e0e0e',
          darkSubMenuItemBg: '#0a0a0a',
          itemHeight: 36,
          darkItemColor: '#b8b1a3',
          darkItemSelectedBg: 'rgba(212, 165, 116, 0.08)',
          darkItemSelectedColor: '#d4a574',
          darkItemHoverBg: 'rgba(212, 165, 116, 0.05)',
        },
        Card: { colorBgContainer: '#181613', colorBorderSecondary: '#2a2620' },
      },
    },
  },

  light: {
    id: 'light',
    label: 'Atelier Light',
    description: 'Warm paper + copper',
    isDark: false,
    vars: {
      // 2026-07-12: 拉大背景层级差异，确保区域可区分
      '--ab-bg':           '#f7f4ee',
      '--ab-bg-1':         '#efe9dd',
      '--ab-bg-2':         '#e6dfd0',
      '--ab-bg-3':         '#d8cfba',
      '--ab-surface':      '#ffffff',
      '--ab-surface-2':    '#f2ede3',
      // 2026-07-12: 加深边框线，light 模式下区域边界需更明显
      '--ab-line':         '#c8bfa8',
      '--ab-line-soft':    'rgba(140, 90, 30, 0.14)',
      '--ab-line-bold':    'rgba(140, 90, 30, 0.34)',
      // 2026-07-12: 加深 text-4，原来 #a8a094 在 #e6dfd0 底上对比度不足
      '--ab-text':         '#1f1c16',
      '--ab-text-2':       '#4a4438',
      '--ab-text-3':       '#756e60',
      '--ab-text-4':       '#8c8576',
      // 2026-07-12: 铜色加深，亮底上需更深才有视觉重量
      '--ab-copper':       '#a87028',
      '--ab-copper-2':     '#986018',
      '--ab-copper-hi':    '#b88038',
      '--ab-copper-glow':  'rgba(168, 112, 40, 0.16)',
      '--ab-teal':         '#2a6a66',
      '--ab-teal-hi':      '#3a8a86',
      '--ab-rose':         '#a04838',
      '--ab-moss':         '#5a7a4e',
      '--ab-iris':         '#6a5a88',
      '--ab-shadow-1':     '0 1px 0 rgba(0, 0, 0, 0.03) inset',
      '--ab-shadow-2':     '0 6px 28px rgba(60, 40, 0, 0.10), 0 1px 0 rgba(0, 0, 0, 0.03) inset',
      '--ab-shadow-glow':  '0 0 22px rgba(168, 112, 40, 0.12)',
    },
    ant: {
      algorithm: 'light',
      token: {
        // 2026-07-12: 同步加深的铜色与边框
        colorPrimary: '#a87028',
        borderRadius: 3,
        colorBgContainer: '#ffffff',
        colorBgElevated: '#f2ede3',
        colorBorder: '#c8bfa8',
        colorText: '#1f1c16',
        colorTextSecondary: '#4a4438',
        colorTextTertiary: '#756e60',
        fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
      },
      components: {
        Layout: { siderBg: '#efe9dd', headerBg: '#efe9dd', bodyBg: '#f7f4ee' },
        Menu: {
          itemHeight: 36,
          itemColor: '#4a4438',
          itemSelectedBg: 'rgba(168, 112, 40, 0.10)',
          itemSelectedColor: '#a87028',
          itemHoverBg: 'rgba(168, 112, 40, 0.06)',
        },
        Card: { colorBgContainer: '#ffffff', colorBorderSecondary: '#c8bfa8' },
      },
    },
  },

  midnight: {
    id: 'midnight',
    label: 'Midnight Blue',
    description: 'Deep navy + cyan',
    isDark: true,
    vars: {
      // 2026-07-12: 拉大背景层级差异，原来 #080c14→#141e38 跨度太小，区域难区分
      '--ab-bg':           '#060912',
      '--ab-bg-1':         '#0a1020',
      '--ab-bg-2':         '#0f1830',
      '--ab-bg-3':         '#162040',
      '--ab-surface':      '#182848',
      '--ab-surface-2':    '#1f3258',
      // 2026-07-12: 加亮边框线，原来 #243056 在深蓝底上几乎不可见
      '--ab-line':         '#2a3a64',
      '--ab-line-soft':    'rgba(86, 180, 232, 0.16)',
      '--ab-line-bold':    'rgba(86, 180, 232, 0.38)',
      '--ab-text':         '#e0ecf6',
      '--ab-text-2':       '#a8b8d4',
      '--ab-text-3':       '#7888b0',
      '--ab-text-4':       '#5a6a90',
      '--ab-copper':       '#5ec4f0',
      '--ab-copper-2':     '#4ab0dc',
      '--ab-copper-hi':    '#76d4fa',
      '--ab-copper-glow':  'rgba(94, 196, 240, 0.20)',
      '--ab-teal':         '#4ec9b0',
      '--ab-teal-hi':      '#6adcc4',
      '--ab-rose':         '#e070a0',
      '--ab-moss':         '#7ec880',
      '--ab-iris':         '#a888e0',
      '--ab-shadow-1':     '0 1px 0 rgba(120, 180, 255, 0.03) inset',
      '--ab-shadow-2':     '0 8px 32px rgba(0, 0, 0, 0.65), 0 1px 0 rgba(86, 180, 232, 0.06) inset',
      '--ab-shadow-glow':  '0 0 26px rgba(86, 180, 232, 0.15)',
    },
    ant: {
      algorithm: 'dark',
      token: {
        // 2026-07-12: 同步加亮的铜色与边框
        colorPrimary: '#5ec4f0',
        borderRadius: 3,
        colorBgContainer: '#0a1020',
        colorBgElevated: '#182848',
        colorBorder: '#2a3a64',
        colorText: '#e0ecf6',
        colorTextSecondary: '#a8b8d4',
        colorTextTertiary: '#7888b0',
        fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
      },
      components: {
        Layout: { siderBg: '#0a1020', headerBg: '#0a1020', bodyBg: '#060912' },
        Menu: {
          darkItemBg: '#0a1020',
          darkSubMenuItemBg: '#060912',
          itemHeight: 36,
          darkItemColor: '#a8b8d4',
          darkItemSelectedBg: 'rgba(94, 196, 240, 0.10)',
          darkItemSelectedColor: '#5ec4f0',
          darkItemHoverBg: 'rgba(94, 196, 240, 0.06)',
        },
        Card: { colorBgContainer: '#182848', colorBorderSecondary: '#2a3a64' },
      },
    },
  },

  carbon: {
    id: 'carbon',
    label: 'Carbon Green',
    description: 'Pure dark + electric green',
    isDark: true,
    vars: {
      '--ab-bg':           '#0a0d0a',
      '--ab-bg-1':         '#0e120e',
      '--ab-bg-2':         '#121612',
      '--ab-bg-3':         '#161a16',
      '--ab-surface':      '#181c18',
      '--ab-surface-2':    '#1f241f',
      '--ab-line':         '#262e26',
      '--ab-line-soft':    'rgba(120, 220, 100, 0.14)',
      '--ab-line-bold':    'rgba(120, 220, 100, 0.32)',
      '--ab-text':         '#d8e8d4',
      '--ab-text-2':       '#a0b09a',
      '--ab-text-3':       '#687068',
      '--ab-text-4':       '#3a403a',
      '--ab-copper':       '#78dc64',
      '--ab-copper-2':     '#68c858',
      '--ab-copper-hi':    '#8cf078',
      '--ab-copper-glow':  'rgba(120, 220, 100, 0.18)',
      '--ab-teal':         '#5ac8a0',
      '--ab-teal-hi':      '#7ae0b8',
      '--ab-rose':         '#e07878',
      '--ab-moss':         '#88c878',
      '--ab-iris':         '#a888e0',
      '--ab-shadow-1':     '0 1px 0 rgba(120, 220, 100, 0.02) inset',
      '--ab-shadow-2':     '0 8px 32px rgba(0, 0, 0, 0.55), 0 1px 0 rgba(120, 220, 100, 0.04) inset',
      '--ab-shadow-glow':  '0 0 24px rgba(120, 220, 100, 0.12)',
    },
    ant: {
      algorithm: 'dark',
      token: {
        colorPrimary: '#78dc64',
        borderRadius: 3,
        colorBgContainer: '#0e120e',
        colorBgElevated: '#181c18',
        colorBorder: '#262e26',
        colorText: '#d8e8d4',
        colorTextSecondary: '#a0b09a',
        colorTextTertiary: '#687068',
        fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
      },
      components: {
        Layout: { siderBg: '#0e120e', headerBg: '#0e120e', bodyBg: '#0a0d0a' },
        Menu: {
          darkItemBg: '#0e120e',
          darkSubMenuItemBg: '#0a0d0a',
          itemHeight: 36,
          darkItemColor: '#a0b09a',
          darkItemSelectedBg: 'rgba(120, 220, 100, 0.08)',
          darkItemSelectedColor: '#78dc64',
          darkItemHoverBg: 'rgba(120, 220, 100, 0.05)',
        },
        Card: { colorBgContainer: '#181c18', colorBorderSecondary: '#262e26' },
      },
    },
  },
}

const STORAGE_KEY = 'autobot-theme'

export function getThemeId() {
  return localStorage.getItem(STORAGE_KEY) || 'atelier'
}

export function getTheme(themeId) {
  return THEMES[themeId] || THEMES.atelier
}

export function applyTheme(themeId) {
  const t = getTheme(themeId)
  const root = document.documentElement
  Object.entries(t.vars).forEach(([k, v]) => root.style.setProperty(k, v))
  root.style.colorScheme = t.isDark ? 'dark' : 'light'
  localStorage.setItem(STORAGE_KEY, themeId)
}

export function setTheme(themeId) {
  if (!THEMES[themeId]) return
  applyTheme(themeId)
  // dispatch event so React components can re-render
  window.dispatchEvent(new CustomEvent('theme-change', { detail: themeId }))
}

/** init theme on first load — call once in main.jsx or App entry */
export function initTheme() {
  applyTheme(getThemeId())
}
