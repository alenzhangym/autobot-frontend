import React from 'react'
import ReactDOM from 'react-dom/client'
import './i18n'
import App from './App.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import './index.css'

// 2026-07-20 P2-fonts: 自托管子集化字体 — 替代 Google Fonts CDN
// @fontsource 默认仅打包 latin subset（拉丁字母+数字+标点），不含中文字形
// 中文通过 CSS fallback 链回退到系统中文体（如 "PingFang SC" / "Microsoft YaHei"），
// 避免下载几 MB 中文字体文件
//
// 仅 import 实际用到的 weight（基于代码统计）：
//   Fraunces:        300/400/500（serif 标题，原 600/700/900 未使用）
//   Hanken Grotesk:  400/500    （body，原 300/600/700 未使用）
//   JetBrains Mono:  400/500    （mono，原 300/600/700 未使用）
// 单个 woff2 约 30-80KB，总 ~400KB，比 Google Fonts 全量加载 ~2MB 减少 80%
import '@fontsource/fraunces/300.css'
import '@fontsource/fraunces/400.css'
import '@fontsource/fraunces/500.css'
import '@fontsource/hanken-grotesk/400.css'
import '@fontsource/hanken-grotesk/500.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
