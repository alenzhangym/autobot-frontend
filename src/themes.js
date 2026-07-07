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
      '--ab-bg':           '#f5f2ec',
      '--ab-bg-1':         '#eeeae1',
      '--ab-bg-2':         '#e8e3d8',
      '--ab-bg-3':         '#dfd9cc',
      '--ab-surface':      '#ffffff',
      '--ab-surface-2':    '#f9f6f0',
      '--ab-line':         '#d4ccb8',
      '--ab-line-soft':    'rgba(180, 130, 60, 0.12)',
      '--ab-line-bold':    'rgba(180, 130, 60, 0.28)',
      '--ab-text':         '#2a2620',
      '--ab-text-2':       '#5a5448',
      '--ab-text-3':       '#807a6e',
      '--ab-text-4':       '#a8a094',
      '--ab-copper':       '#b8823c',
      '--ab-copper-2':     '#a87430',
      '--ab-copper-hi':    '#c89760',
      '--ab-copper-glow':  'rgba(184, 130, 60, 0.15)',
      '--ab-teal':         '#3a7a76',
      '--ab-teal-hi':      '#4a9a96',
      '--ab-rose':         '#b56858',
      '--ab-moss':         '#6a8a5e',
      '--ab-iris':         '#7a6a98',
      '--ab-shadow-1':     '0 1px 0 rgba(0, 0, 0, 0.02) inset',
      '--ab-shadow-2':     '0 4px 24px rgba(0, 0, 0, 0.08), 0 1px 0 rgba(0, 0, 0, 0.02) inset',
      '--ab-shadow-glow':  '0 0 20px rgba(184, 130, 60, 0.10)',
    },
    ant: {
      algorithm: 'light',
      token: {
        colorPrimary: '#b8823c',
        borderRadius: 3,
        colorBgContainer: '#ffffff',
        colorBgElevated: '#f9f6f0',
        colorBorder: '#d4ccb8',
        colorText: '#2a2620',
        colorTextSecondary: '#5a5448',
        colorTextTertiary: '#807a6e',
        fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
      },
      components: {
        Layout: { siderBg: '#eeeae1', headerBg: '#eeeae1', bodyBg: '#f5f2ec' },
        Menu: {
          itemHeight: 36,
          itemColor: '#5a5448',
          itemSelectedBg: 'rgba(184, 130, 60, 0.08)',
          itemSelectedColor: '#b8823c',
          itemHoverBg: 'rgba(184, 130, 60, 0.05)',
        },
        Card: { colorBgContainer: '#ffffff', colorBorderSecondary: '#d4ccb8' },
      },
    },
  },

  midnight: {
    id: 'midnight',
    label: 'Midnight Blue',
    description: 'Deep navy + cyan',
    isDark: true,
    vars: {
      '--ab-bg':           '#080c14',
      '--ab-bg-1':         '#0c1220',
      '--ab-bg-2':         '#101830',
      '--ab-bg-3':         '#141e38',
      '--ab-surface':      '#162038',
      '--ab-surface-2':    '#1c2848',
      '--ab-line':         '#243056',
      '--ab-line-soft':    'rgba(86, 180, 232, 0.14)',
      '--ab-line-bold':    'rgba(86, 180, 232, 0.32)',
      '--ab-text':         '#d8e4f0',
      '--ab-text-2':       '#9ca8c0',
      '--ab-text-3':       '#6878a0',
      '--ab-text-4':       '#3a4868',
      '--ab-copper':       '#56b4e8',
      '--ab-copper-2':     '#4a9cd0',
      '--ab-copper-hi':    '#6ac4f0',
      '--ab-copper-glow':  'rgba(86, 180, 232, 0.18)',
      '--ab-teal':         '#4ec9b0',
      '--ab-teal-hi':      '#6adcc4',
      '--ab-rose':         '#e070a0',
      '--ab-moss':         '#7ec880',
      '--ab-iris':         '#a888e0',
      '--ab-shadow-1':     '0 1px 0 rgba(120, 180, 255, 0.02) inset',
      '--ab-shadow-2':     '0 8px 32px rgba(0, 0, 0, 0.6), 0 1px 0 rgba(86, 180, 232, 0.04) inset',
      '--ab-shadow-glow':  '0 0 24px rgba(86, 180, 232, 0.12)',
    },
    ant: {
      algorithm: 'dark',
      token: {
        colorPrimary: '#56b4e8',
        borderRadius: 3,
        colorBgContainer: '#0c1220',
        colorBgElevated: '#162038',
        colorBorder: '#243056',
        colorText: '#d8e4f0',
        colorTextSecondary: '#9ca8c0',
        colorTextTertiary: '#6878a0',
        fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
      },
      components: {
        Layout: { siderBg: '#0c1220', headerBg: '#0c1220', bodyBg: '#080c14' },
        Menu: {
          darkItemBg: '#0c1220',
          darkSubMenuItemBg: '#080c14',
          itemHeight: 36,
          darkItemColor: '#9ca8c0',
          darkItemSelectedBg: 'rgba(86, 180, 232, 0.08)',
          darkItemSelectedColor: '#56b4e8',
          darkItemHoverBg: 'rgba(86, 180, 232, 0.05)',
        },
        Card: { colorBgContainer: '#162038', colorBorderSecondary: '#243056' },
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
