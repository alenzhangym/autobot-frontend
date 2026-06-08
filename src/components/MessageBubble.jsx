import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Avatar, Button, Tooltip, Space, Tag, Collapse } from 'antd';
import { RobotOutlined, UserOutlined, CopyOutlined, CheckOutlined, CloseOutlined, ReloadOutlined, ExpandAltOutlined, LoadingOutlined, ClockCircleOutlined, ApartmentOutlined, LinkOutlined, BranchesOutlined, NodeIndexOutlined, ShareAltOutlined, DeleteOutlined, AppstoreOutlined, ExclamationCircleOutlined, BulbOutlined } from '@ant-design/icons';
import { useState, useEffect } from 'react';
import { extractDataStoreIds, isValidDataStoreResponse, fetchMissingDataFromServer, injectDataStoreData, decodeHtmlEntities, cleanScriptSrc, wrapUiHtml, isHtmlContent, MarkdownContent, extractTrailingJsonObject, extractTrailingStateJson, stripTrailingStateJson } from '../utils/helpers.jsx';


/**
 * Strip agent command markers and trailing JSON state from message content.
 * Removes __CMD__ blocks and the {...} state JSON at the end.
 *
 * <p>Refactored: now delegates to the depth-tracking
 * {@link extractTrailingStateJson} and {@link stripTrailingStateJson}
 * utilities in helpers.jsx. The previous implementation used naive
 * {@code lastIndexOf('}')} / {@code lastIndexOf(stateJson)} which
 * could crash on nested objects or strip the wrong occurrence when
 * the state JSON appeared earlier in the content.</p>
 */
function extractTrailingAnalysisStateJson(content) {
  if (!content || typeof content !== 'string') return ''
  const stateJson = extractTrailingStateJson(content)
  return stateJson || ''
}

function stripAgentMarkers(content) {
  if (!content || typeof content !== 'string') return content
  // Remove everything from first __CMD__ to end of line
  let cleaned = content.replace(/__CMD__\{[^}]*\}/g, '').replace(/__CMD__[^\n]*/g, '')
  const commandResultsIdx = cleaned.indexOf('[COMMAND_RESULTS]')
  if (commandResultsIdx >= 0) {
    cleaned = cleaned.substring(0, commandResultsIdx)
  }
  // Use depth-tracking utility instead of lastIndexOf(stateJson)
  cleaned = stripTrailingStateJson(cleaned)
  // Remove duplicate newlines left behind
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n')
  return cleaned.trim()
}

function extractAnalysisState(content) {
  if (!content || typeof content !== 'string') return null
  const stateJson = extractTrailingStateJson(content)
  if (!stateJson) return null
  try {
    const parsed = JSON.parse(stateJson)
    return parsed && parsed.__state ? parsed : null
  } catch (e) {
    return null
  }
}

function decodeStateStringList(encoded) {
  if (!encoded || typeof encoded !== 'string') return []
  try {
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4)
    const decoded = atob(padded)
    const bytes = Uint8Array.from(decoded, ch => ch.charCodeAt(0))
    const text = new TextDecoder().decode(bytes)
    const parsed = JSON.parse(text)
    return Array.isArray(parsed)
      ? parsed.filter(item => typeof item === 'string' && item.trim())
      : []
  } catch (e) {
    return []
  }
}

/**
 * Try to extract a structured analysis-result JSON block from arbitrary text.
 * The CodeAnalysisAgent final round emits a JSON object with one or more of
 * {modules, linkages, issues, recommendations} arrays.  We accept:
 *   - bare JSON
 *   - JSON inside ```json ... ``` fences
 *   - JSON preceded/followed by prose
 * Returns { parsed, prefix, suffix } on success, or null if no such block
 * is present (so the caller can fall through to the markdown / HTML path).
 */
function tryParseAnalysisResult(content) {
  if (!content || typeof content !== 'string') return null
  let text = content.trim()
  if (!text) return null
  // Strip outer markdown code fence
  text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '')
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaping = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (escaping) { escaping = false; continue }
    if (ch === '\\') { escaping = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        const candidate = text.slice(start, i + 1)
        let parsed
        try {
          parsed = JSON.parse(candidate)
        } catch (e) {
          return null
        }
        const hasShape = parsed && typeof parsed === 'object' && (
          Array.isArray(parsed.modules) ||
          Array.isArray(parsed.linkages) ||
          Array.isArray(parsed.issues) ||
          Array.isArray(parsed.recommendations)
        )
        if (!hasShape) return null
        return {
          parsed,
          prefix: text.slice(0, start).trim(),
          suffix: text.slice(i + 1).trim()
        }
      }
    }
  }
  return null
}

function formatAnalysisPhase(phase) {
  switch ((phase || '').trim()) {
    case 'sync_tree':
      return '同步目录'
    case 'bootstrap_scan':
      return '分层扫描'
    case 'initial_read':
      return '读取核心代码'
    case 'focused_read':
      return '精准补片段'
    case 'iterative_read':
      return '继续补证据'
    default:
      return '分析中'
  }
}

function estimateAnalysisProgress(state) {
  if (!state) return 0
  const phase = (state.__phase || '').trim()
  const round = Number(state.__round || 0)
  const maxRounds = Math.max(1, Number(state.__max_rounds || 10))
  const roundRatio = Math.min(1, Math.max(0, round / maxRounds))
  const signals = state.__convergence_signals || {}
  const newReads = Number(signals.new_reads_this_round || 0)
  const newCommands = Number(signals.new_commands_this_round || 0)
  // Self-converging boost: if round>3 and no progress this round, accelerate progress
  // (signals the analysis is winding down).
  const stuck = round > 3 && newReads === 0 && newCommands === 0
  const stuckBoost = stuck ? 0.15 : 0
  switch (phase) {
    case 'sync_tree':
      return 8
    case 'bootstrap_scan':
      return 18
    case 'initial_read':
      return Math.min(38, 24 + Number(state.__read_count || 0) * 3)
    case 'focused_read':
      return Math.min(72, 50 + Number(state.__read_count || 0) * 2)
    case 'iterative_read':
      return Math.min(95, Math.round((roundRatio + stuckBoost) * 100))
    default:
      return Math.min(90, Math.round((roundRatio + stuckBoost) * 100))
  }
}

function CodeAnalysisProgress({ state }) {
  if (!state || state.__state !== 'AWAITING_COMMANDS') return null
  const progress = estimateAnalysisProgress(state)
  const phaseLabel = formatAnalysisPhase(state.__phase)
  const round = Number(state.__round || 0)
  const maxRounds = Math.max(1, Number(state.__max_rounds || 10))
  const readCount = Number(state.__read_count || 0)
  const retainedCount = Number(state.__retained_context_count || 0)
  const pendingCommands = Number(state.__pending_commands || 0)
  const completedFiles = decodeStateStringList(state.__completed_read_files)
  const recentReadFiles = decodeStateStringList(state.__recent_read_files)
  const fallbackReadFiles = completedFiles.length > 0 ? completedFiles : decodeStateStringList(state.__read)
  const readFiles = fallbackReadFiles.slice().reverse()

  return (
    <div style={{
      marginBottom: 12,
      background: '#141414',
      border: '1px solid #262626',
      borderRadius: 10,
      padding: '10px 12px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <Tag color="blue" style={{ margin: 0 }}>代码分析进度</Tag>
        <Tag style={{ margin: 0, background: '#1f1f1f', color: '#d9d9d9', borderColor: '#303030' }}>{phaseLabel}</Tag>
        <Tag style={{ margin: 0, background: '#1f1f1f', color: '#d9d9d9', borderColor: '#303030' }}>轮次 {round}/{maxRounds}</Tag>
        {state.__convergence_signals && (() => {
          const sig = state.__convergence_signals
          const newReads = Number(sig.new_reads_this_round || 0)
          const newCmds = Number(sig.new_commands_this_round || 0)
          const stuck = round > 3 && newReads === 0 && newCmds === 0
          if (stuck) {
            return (
              <Tag color="orange" style={{ margin: 0 }}>
                收敛中（无新进展）
              </Tag>
            )
          }
          if (newReads > 0 || newCmds > 0) {
            return (
              <Tag color="cyan" style={{ margin: 0 }}>
                本轮 +{newReads}读 / +{newCmds}指令
              </Tag>
            )
          }
          return null
        })()}
      </div>
      <div style={{ height: 6, background: '#262626', borderRadius: 999, overflow: 'hidden', marginBottom: 10 }}>
        <div style={{
          width: `${progress}%`,
          height: '100%',
          background: 'linear-gradient(90deg, #1677ff, #52c41a)',
          transition: 'width 0.2s ease'
        }} />
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', color: '#a6a6a6', fontSize: 12 }}>
        <span>已读文件: {readCount}</span>
        <span>保留上下文: {retainedCount}</span>
        <span>待执行命令: {pendingCommands}</span>
        <span>进度估计: {progress}%</span>
      </div>
      {recentReadFiles.length > 0 && (
        <div style={{
          marginTop: 10,
          background: 'rgba(22, 119, 255, 0.08)',
          border: '1px solid rgba(22, 119, 255, 0.24)',
          borderRadius: 8,
          padding: '8px 10px'
        }}>
          <div style={{ color: '#91caff', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            最近一次新增读取
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {recentReadFiles.map((file, idx) => (
              <div
                key={`${file}-recent-${idx}`}
                style={{
                  color: '#d6e4ff',
                  fontSize: 12,
                  lineHeight: 1.5,
                  fontFamily: 'Consolas, Monaco, monospace',
                  wordBreak: 'break-all'
                }}
              >
                {file}
              </div>
            ))}
          </div>
        </div>
      )}
      {readFiles.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <Collapse
            ghost
            size="small"
            items={[
              {
                key: 'read-files',
                label: `已读文件列表 (${readFiles.length})`,
                children: (
                  <div style={{
                    maxHeight: 180,
                    overflow: 'auto',
                    background: '#101010',
                    border: '1px solid #262626',
                    borderRadius: 8,
                    padding: '8px 10px'
                  }}>
                    {readFiles.map((file, idx) => (
                      <div
                        key={`${file}-${idx}`}
                        style={{
                          color: '#cfcfcf',
                          fontSize: 12,
                          lineHeight: 1.6,
                          fontFamily: 'Consolas, Monaco, monospace',
                          wordBreak: 'break-all'
                        }}
                      >
                        {file}
                      </div>
                    ))}
                  </div>
                )
              }
            ]}
          />
        </div>
      )}
    </div>
  )
}

const PRIORITY_COLOR = {
  P0: { color: '#ff4d4f', bg: 'rgba(255,77,79,0.10)' },
  P1: { color: '#fa541c', bg: 'rgba(250,84,28,0.10)' },
  P2: { color: '#fa8c16', bg: 'rgba(250,140,22,0.10)' },
  P3: { color: '#1677ff', bg: 'rgba(22,119,255,0.10)' },
};

const PRIORITY_TAG_COLOR = {
  P0: 'red',
  P1: 'volcano',
  P2: 'orange',
  P3: 'blue',
};

/**
 * Renders the trailing "java-backend/.../X.java [已证实]" style evidence
 * as a monospaced path tag plus a green confirmation tag when present.
 */
function EvidenceTag({ text }) {
  if (!text) return null;
  const m = String(text).match(/^(.*?)(\s*\[(已证实|confirmed|✓)\])?$/i);
  const path = m ? m[1].trim() : String(text).trim();
  const confirmed = m && m[3];
  return (
    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <code style={{
        background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 4,
        padding: '2px 6px', fontSize: 11, color: '#a6a6a6',
        fontFamily: 'Consolas, Monaco, monospace',
        wordBreak: 'break-all',
      }}>
        {path}
      </code>
      {confirmed && (
        <Tag color="green" style={{ fontSize: 10, margin: 0 }}>✓ 已证实</Tag>
      )}
    </div>
  );
}

/**
 * Render a structured code-analysis result.
 * Expected shape: { modules?, linkages?, issues?, recommendations? }
 */
function StructuredAnalysisView({ data }) {
  if (!data) return null;
  const modules = Array.isArray(data.modules) ? data.modules : [];
  const linkages = Array.isArray(data.linkages) ? data.linkages : [];
  const issues = Array.isArray(data.issues) ? data.issues : [];
  const recommendations = Array.isArray(data.recommendations) ? data.recommendations : [];

  const renderSection = (title, icon, children) => (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
        paddingBottom: 6, borderBottom: '1px solid #2a2a2a',
      }}>
        {icon}
        <span style={{ color: '#e3e3e3', fontSize: 14, fontWeight: 600 }}>{title}</span>
      </div>
      {children}
    </div>
  );

  return (
    <div style={{ color: '#e3e3e3', marginTop: 8 }}>
      <div style={{
        marginBottom: 14, padding: '8px 12px',
        background: 'rgba(22,119,255,0.08)', border: '1px solid rgba(22,119,255,0.24)',
        borderRadius: 8, fontSize: 12, color: '#91caff',
      }}>
        分析结果概览：{modules.length} 模块 · {linkages.length} 关联 · {issues.length} 风险 · {recommendations.length} 建议
      </div>

      {modules.length > 0 && renderSection('核心模块', <AppstoreOutlined style={{ color: '#1677ff' }} />,
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
          {modules.map((m, i) => (
            <div key={i} style={{
              background: '#141414', border: '1px solid #262626', borderRadius: 8,
              padding: '10px 12px',
            }}>
              <div style={{ color: '#1677ff', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                {m.name}
              </div>
              <div style={{ color: '#cfcfcf', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {m.responsibility}
              </div>
              <EvidenceTag text={m.evidence} />
            </div>
          ))}
        </div>
      )}

      {linkages.length > 0 && renderSection('模块关联', <ShareAltOutlined style={{ color: '#722ed1' }} />,
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {linkages.map((l, i) => (
            <div key={i} style={{
              background: '#141414', border: '1px solid #262626', borderRadius: 8,
              padding: '10px 12px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <Tag color="purple" style={{ margin: 0, fontSize: 11 }}>{l.type}</Tag>
                <span style={{ color: '#1677ff', fontSize: 12, fontWeight: 500 }}>{l.source}</span>
                <span style={{ color: '#666', fontSize: 12 }}>→</span>
                <span style={{ color: '#1677ff', fontSize: 12, fontWeight: 500 }}>{l.target}</span>
              </div>
              <div style={{ color: '#cfcfcf', fontSize: 12, lineHeight: 1.6 }}>{l.description}</div>
              <EvidenceTag text={l.evidence} />
            </div>
          ))}
        </div>
      )}

      {issues.length > 0 && renderSection('潜在问题', <ExclamationCircleOutlined style={{ color: '#fa8c16' }} />,
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {issues.map((issue, i) => {
            const cfg = PRIORITY_COLOR[issue.risk_level] || { color: '#888', bg: 'rgba(136,136,136,0.10)' };
            const tagColor = PRIORITY_TAG_COLOR[issue.risk_level] || 'default';
            return (
              <div key={i} style={{
                background: cfg.bg, border: `1px solid ${cfg.color}44`,
                borderRadius: 8, padding: '10px 12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <Tag color={tagColor} style={{ margin: 0 }}>{issue.risk_level || '?'}</Tag>
                  <span style={{ color: cfg.color, fontSize: 13, fontWeight: 600 }}>{issue.type}</span>
                </div>
                <div style={{ color: '#e3e3e3', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {issue.description}
                </div>
                <EvidenceTag text={issue.evidence} />
              </div>
            );
          })}
        </div>
      )}

      {recommendations.length > 0 && renderSection('改进建议', <BulbOutlined style={{ color: '#52c41a' }} />,
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {recommendations.map((r, i) => {
            const cfg = PRIORITY_COLOR[r.priority] || { color: '#888', bg: 'rgba(136,136,136,0.10)' };
            const tagColor = PRIORITY_TAG_COLOR[r.priority] || 'default';
            return (
              <div key={i} style={{
                background: '#141414', border: `1px solid ${cfg.color}44`,
                borderRadius: 8, padding: '10px 12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <Tag color={tagColor} style={{ margin: 0 }}>{r.priority || '?'}</Tag>
                  <span style={{ color: cfg.color, fontSize: 13, fontWeight: 600 }}>{r.direction}</span>
                </div>
                <div style={{ color: '#cfcfcf', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {r.action}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ msg, onCopy, onRegenerate, onExpand, onDelete, sessionId, index }) {
  const [copied, setCopied] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const isUser = msg.role === 'user';
  const isPlan = msg.role === 'plan';
  const analysisState = typeof msg.content === 'string' ? extractAnalysisState(msg.content) : null

  const handleCopy = () => {
    if (onCopy) onCopy(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isPlan && msg.content && msg.content.plan) {
    return (
      <PlanMessage content={msg.content} onDelete={onDelete} msgId={msg.id} />
    );
  }

  const isUiRender = msg.role === 'ui_render' || (msg.content && typeof msg.content === 'object' && msg.content.type === 'ui_render');
  // When content is already a string (the HTML), use it directly - don't use JSON.stringify which adds quotes!
  let uiContent = null;
  if (isUiRender) {
    if (typeof msg.content === 'string') {
      uiContent = msg.content;
    } else if (msg.content && typeof msg.content === 'object') {
      uiContent = msg.content.content || msg.content.html || JSON.stringify(msg.content);
    }
  }
  const [injectedHtml, setInjectedHtml] = useState(null);

  useEffect(() => {
    if (!uiContent) {
      setInjectedHtml(null);
      return;
    }

    const processed = wrapUiHtml(uiContent);
    
    const dataIds = extractDataStoreIds(uiContent);
    if (dataIds.length === 0) {
      // Final URL cleanup pass
      const finalHtml = cleanScriptSrc(processed);
      setInjectedHtml(finalHtml);
      return;
    }

    const dataStoreData = {};
    let hasLocalData = false;
    const missingIds = [];

    // Check IndexedDB and server for data store IDs
    Promise.all(dataIds.map(async id => {
      try {
        const dbData = await window.__getDataFromIndexedDB?.(id);
        if (dbData !== undefined) {
          dataStoreData[id] = dbData;
          hasLocalData = true;
        } else {
          missingIds.push(id);
        }
      } catch (e) {
        missingIds.push(id);
      }
    })).then(() => {

    if (missingIds.length > 0) {
      fetchMissingDataFromServer(missingIds).then(serverData => {
        serverData.forEach(({ id, data }) => {
          dataStoreData[id] = data;
        });
        let injected = injectDataStoreData(processed, dataStoreData);
        // Final URL cleanup pass
        injected = cleanScriptSrc(injected);
        setInjectedHtml(injected);
      });
    }

    if (hasLocalData || missingIds.length === 0) {
      let injected = injectDataStoreData(processed, dataStoreData);
      // Final URL cleanup pass
      injected = cleanScriptSrc(injected);
      setInjectedHtml(injected);
    }
    });
  }, [uiContent]);

  // ESC to close fullscreen
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  if (uiContent) {
    const iframeDoc = injectedHtml || uiContent;
    return (
      <>
        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          <Avatar icon={<RobotOutlined />} size={32} style={{ background: '#1677ff', flexShrink: 0 }} />
          <div style={{ flex: 1, maxWidth: 'calc(100% - 50px)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ color: '#888', fontSize: 12 }}>AutoBot</span>
              <Tag color="purple" style={{ fontSize: 10 }}>UI Render</Tag>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                {onDelete && msg.id && (
                  <Tooltip title="Delete">
                    <Button type="text" icon={<DeleteOutlined />} size="small" onClick={onDelete} style={{ color: '#666' }} />
                  </Tooltip>
                )}
                <Tooltip title="全屏">
                  <Button type="text" size="small" icon={<ExpandAltOutlined />} onClick={() => setFullscreen(true)} style={{ color: '#888' }} />
                </Tooltip>
              </div>
            </div>
            <iframe
              srcDoc={iframeDoc}
              style={{ width: '100%', minHeight: 400, border: '1px solid #2a2a2a', borderRadius: 12, background: '#141414' }}
              sandbox="allow-scripts allow-same-origin"
            />
          </div>
        </div>
        {fullscreen && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            zIndex: 9999, background: '#141414',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
              padding: '8px 16px', background: '#1a1a1a',
              borderBottom: '1px solid #2a2a2a',
            }}>
              <Button
                type="text"
                icon={<CloseOutlined />}
                onClick={() => setFullscreen(false)}
                style={{ color: '#888', fontSize: 16 }}
              >
                关闭
              </Button>
            </div>
            <iframe
              srcDoc={iframeDoc}
              style={{ flex: 1, width: '100%', border: 'none', background: '#141414' }}
              sandbox="allow-scripts allow-same-origin"
            />
          </div>
        )}
      </>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexDirection: isUser ? 'row-reverse' : 'row' }}>
      <Avatar icon={isUser ? <UserOutlined /> : <RobotOutlined />} size={32} style={{ background: isUser ? '#555' : '#1677ff', flexShrink: 0 }} />
      <div style={{ maxWidth: 'calc(100% - 50px)', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ color: '#888', fontSize: 12 }}>{isUser ? 'You' : 'AutoBot'}</span>
          {msg.timestamp && <span style={{ color: '#555', fontSize: 11 }}>{msg.timestamp}</span>}
          {!isUser && msg.model && <Tag style={{ fontSize: 10, margin: 0 }}>{msg.model}</Tag>}
        </div>
        <div style={{ 
          background: isUser ? '#1a1a1a' : '#111', 
          borderRadius: 12, 
          padding: isUser ? '12px 16px' : '4px 0',
          border: isUser ? '1px solid #2a2a2a' : 'none'
        }}>
          {msg.code && msg.code !== msg.content ? (
            <div style={{ marginBottom: 8 }}>
              <pre style={{ background: '#1e1e1e', padding: 12, borderRadius: 8, overflow: 'auto', fontSize: 12, margin: 0 }}>
                <code>{msg.code}</code>
              </pre>
            </div>
          ) : null}
          {!isUser && analysisState && <CodeAnalysisProgress state={analysisState} />}
          {msg.content && typeof msg.content === 'string' && renderContent(stripAgentMarkers(msg.content))}
          {msg.content && typeof msg.content === 'object' && !msg.content.plan && (
            msg.content.type === 'provenance_context'
              ? <ProvenanceContextView units={msg.content.units} />
              : <div style={{ color: '#e3e3e3', fontSize: 14, whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(msg.content, null, 2)}
                </div>
          )}
          {msg.chartData && (
            <div style={{ marginTop: 12 }}>
              <pre style={{ background: '#1e1e1e', padding: 12, borderRadius: 8, overflow: 'auto', fontSize: 11, margin: 0 }}>
                {JSON.stringify(msg.chartData, null, 2)}
              </pre>
            </div>
          )}
        </div>
        {!isPlan && (
          <div style={{ marginTop: 8, display: 'flex', gap: 4, justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
            {!isUser && (
              <>
                <Tooltip title={copied ? 'Copied!' : 'Copy'}>
                  <Button type="text" icon={copied ? <CheckOutlined /> : <CopyOutlined />} size="small" onClick={handleCopy} style={{ color: '#666' }} />
                </Tooltip>
                {onRegenerate && index > 0 && (
                  <Tooltip title="Regenerate">
                    <Button type="text" icon={<ReloadOutlined />} size="small" onClick={() => onRegenerate(index)} style={{ color: '#666' }} />
                  </Tooltip>
                )}
                {onExpand && msg.content && (
                  <Tooltip title="Expand">
                    <Button type="text" icon={<ExpandAltOutlined />} size="small" onClick={() => onExpand(msg.content)} style={{ color: '#666' }} />
                  </Tooltip>
                )}
              </>
            )}
            {onDelete && msg.id && (
              <Tooltip title="Delete">
                <Button type="text" icon={<DeleteOutlined />} size="small" onClick={onDelete} style={{ color: isUser ? '#555' : '#666' }} />
              </Tooltip>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PlanMessage({ content, onDelete, msgId }) {
  const [expandedSteps, setExpandedSteps] = useState({});
  const plan = content.plan || [];
  const status = content.status;

  // ── Intent classification (v2.1) ────────────────────────────────────
  const intent = content.intent || '';
  const intentTags = content.intent_tags || [];
  const intentConfidence = content.intent_confidence != null ? content.intent_confidence : 0;
  const entities = content.entities || [];

  /**
   * Map TaskIntent enum to display-friendly label, color, and description.
   */
  const INTENT_CONFIG = {
    KNOWLEDGE_RETRIEVAL:   { label: 'Knowledge Retrieval',    cn: '知识检索',      color: '#1677ff', bg: 'rgba(22,119,255,0.08)',  desc: '从文档/数据库/图谱中查找信息' },
    SYSTEM_OPERATION:       { label: 'System Operation',      cn: '系统操作',      color: '#52c41a', bg: 'rgba(82,196,26,0.08)',   desc: '执行具体动作：安装技能/查询表结构/命令/call API' },
    REASONING_ANALYSIS:    { label: 'Reasoning & Analysis',   cn: '推理论证',      color: '#fa8c16', bg: 'rgba(250,140,22,0.08)',  desc: '因果分析/对比/趋势/根因诊断' },
    AGENT_ORCHESTRATION:   { label: 'Agent Orchestration',    cn: '任务编排',      color: '#722ed1', bg: 'rgba(114,46,209,0.08)',  desc: '多 Agent 协作的端到端工作流' },
    CONVERSATIONAL:         { label: 'Conversational',        cn: '自由对话',      color: '#8c8c8c', bg: 'rgba(140,140,140,0.08)', desc: '闲聊/问候/简单问答' },
  };
  const cfg = INTENT_CONFIG[intent] || { label: intent || 'Unknown', cn: '未知', color: '#8c8c8c', bg: 'rgba(140,140,140,0.08)', desc: '' };
  const pctConf = `${Math.round(intentConfidence * 100)}%`;

  const getStatusIcon = (stepStatus) => {
    switch (stepStatus) {
      case 'completed':
        return <CheckOutlined style={{ color: '#52c41a', fontSize: 16 }} />;
      case 'running':
        return <LoadingOutlined spin style={{ color: '#1890ff', fontSize: 16 }} />;
      case 'pending':
        return <ClockCircleOutlined style={{ color: '#666', fontSize: 16 }} />;
      case 'failed':
        return <CloseOutlined style={{ color: '#ff4d4f', fontSize: 16 }} />;
      default:
        return <ClockCircleOutlined style={{ color: '#666', fontSize: 16 }} />;
    }
  };

  const getStatusColor = (stepStatus) => {
    switch (stepStatus) {
      case 'completed': return '#52c41a';
      case 'running': return '#1890ff';
      case 'pending': return '#666';
      case 'failed': return '#ff4d4f';
      default: return '#666';
    }
  };

  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
      <Avatar icon={<RobotOutlined />} size={32} style={{ background: '#1677ff', flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ color: '#888', fontSize: 12 }}>AutoBot</span>
          <Tag color={status === 'executed' || status === 'completed' ? 'green' : status === 'running' ? 'blue' : 'default'}>
            {status === 'executed' ? 'Completed' : status === 'running' ? 'Executing' : status}
          </Tag>
          {onDelete && msgId && (
            <Tooltip title="Delete plan">
              <Button type="text" icon={<DeleteOutlined />} size="small" onClick={onDelete} style={{ color: '#666', marginLeft: 'auto' }} />
            </Tooltip>
          )}
        </div>
        
        <div style={{ background: '#1a1a1a', borderRadius: 12, padding: 16, border: '1px solid #2a2a2a' }}>
          {/* ── Intent classification banner ─────────────────────── */}
          {intent && (
            <div style={{
              marginBottom: 16, padding: '10px 14px', borderRadius: 8,
              background: cfg.bg, border: `1px solid ${cfg.color}33`,
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            }}>
              <Tooltip title={cfg.desc}>
                <Tag color={cfg.color} style={{ margin: 0 }}>
                  <span style={{ fontWeight: 600 }}>{cfg.cn}</span>
                  &nbsp;·&nbsp;
                  <span style={{ opacity: 0.7 }}>{cfg.label}</span>
                </Tag>
              </Tooltip>
              <Tooltip title="Intent confidence from IntentAnalyzer">
                <span style={{ color: '#888', fontSize: 11 }}>
                  Confidence: <b style={{ color: intentConfidence > 0.7 ? '#52c41a' : '#faad14' }}>{pctConf}</b>
                </span>
              </Tooltip>
              {intentTags.length > 0 && (
                <span style={{ color: '#888', fontSize: 11 }}>
                  Tags: {intentTags.map(t => (
                    <Tag key={t} style={{ fontSize: 10, margin: '0 2px' }}>{t}</Tag>
                  ))}
                </span>
              )}
              {entities.length > 0 && (
                <span style={{ color: '#888', fontSize: 11 }}>
                  Entities: {entities.map(e => (
                    <Tag key={e} color="geekblue" style={{ fontSize: 10, margin: '0 2px' }}>{e}</Tag>
                  ))}
                </span>
              )}
            </div>
          )}

          <span style={{ color: '#e3e3e3', fontSize: 14, fontWeight: 600, display: 'block', marginBottom: 16 }}>
            Plan Execution ({plan.length} steps)
          </span>
          
          <Collapse ghost>
            {plan.map((step, idx) => {
              const stepKey = `step-${idx}`;
              const isExpanded = expandedSteps[stepKey];
              
              return (
                <Collapse.Panel
                  key={stepKey}
                  header={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {getStatusIcon(step.status)}
                      <span style={{ color: getStatusColor(step.status), fontWeight: 500 }}>
                        Step {step.step || idx + 1}
                      </span>
                      <Tag style={{ fontSize: 10 }}>{step.agent}</Tag>
                      <span style={{ color: '#888', fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {step.goal}
                      </span>
                    </div>
                  }
                >
                  <div style={{ padding: '8px 0' }}>
                    <div style={{ marginBottom: 12 }}>
                      <span style={{ color: '#888', fontSize: 11, fontWeight: 600 }}>Goal</span>
                      <div style={{ color: '#e3e3e3', fontSize: 13 }}>{step.goal}</div>
                    </div>
                    
                    {step.args && Object.keys(step.args).length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <span style={{ color: '#888', fontSize: 11, fontWeight: 600 }}>Arguments</span>
                        <pre style={{ background: '#111', padding: 8, borderRadius: 4, fontSize: 11, color: '#aaa', overflow: 'auto', margin: '4px 0' }}>
                          {JSON.stringify(step.args, null, 2)}
                        </pre>
                      </div>
                    )}
                    
                    {step.result && (
                      <div style={{ marginBottom: 12 }}>
                        <span style={{ color: '#888', fontSize: 11, fontWeight: 600 }}>Result</span>
                        <div style={{ color: '#e3e3e3', fontSize: 13, whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto', background: '#111', padding: 8, borderRadius: 4 }}>
                          {typeof step.result === 'string' ? step.result : JSON.stringify(step.result, null, 2)}
                        </div>
                      </div>
                    )}
                    
                    {step.thought && (
                      <div style={{ marginBottom: 12 }}>
                        <span style={{ color: '#888', fontSize: 11, fontWeight: 600 }}>Thought</span>
                        <div style={{ color: '#aaa', fontSize: 12, fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>
                          {step.thought}
                        </div>
                      </div>
                    )}
                  </div>
                </Collapse.Panel>
              );
            })}
          </Collapse>
        </div>
      </div>
    </div>
  );
}


// =============================================================================
// Provenance rendering — step type → visual config
// =============================================================================

const STEP_TYPE_CONFIG = {
  SEED:           { color: '#1677ff', bg: 'rgba(22,119,255,0.12)', icon: <NodeIndexOutlined />, label: 'Direct Hit' },
  RST_UPWARD:     { color: '#0ea5e9', bg: 'rgba(14,165,233,0.12)', icon: <BranchesOutlined />, label: 'RST ↑' },
  RST_DOWNWARD:   { color: '#38bdf8', bg: 'rgba(56,189,248,0.12)', icon: <BranchesOutlined style={{ transform: 'scaleY(-1)' }} />, label: 'RST ↓' },
  INFERRED_LINK:  { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: <LinkOutlined />, label: 'Inferred' },
  CONCEPT_BRIDGE: { color: '#10b981', bg: 'rgba(16,185,129,0.12)', icon: <ShareAltOutlined />, label: 'Concept' },
  ABSTRACT_JUMP:  { color: '#a855f7', bg: 'rgba(168,85,247,0.12)', icon: <ApartmentOutlined />, label: 'Abstract' },
};

/**
 * Single provenance hop tag.
 * Shows the step type icon + bridge label + strength badge.
 */
function ProvenanceTag({ step }) {
  const cfg = STEP_TYPE_CONFIG[step.stepType] || STEP_TYPE_CONFIG.SEED;
  const tooltip = `${step.stepType}${step.fromUnitId ? ' from ' + step.fromUnitId.slice(-8) : ''}`;

  return (
    <Tooltip title={tooltip} placement="top">
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        background: cfg.bg, border: `1px solid ${cfg.color}33`,
        borderRadius: 4, padding: '1px 6px', fontSize: 11,
        color: cfg.color, cursor: 'default', whiteSpace: 'nowrap',
      }}>
        {cfg.icon}
        <span>{step.bridgeLabel || cfg.label}</span>
        {step.strength != null && step.strength < 1.0 && (
          <span style={{ opacity: 0.7, fontSize: 10 }}>
            {step.strength.toFixed(2)}
          </span>
        )}
      </span>
    </Tooltip>
  );
}

/**
 * Renders the provenance chain.
 *
 * Layout strategy:
 *   ≤ 2 hops  → horizontal pill row (compact, no overflow risk)
 *   ≥ 3 hops  → collapsible vertical list with a summary badge when collapsed
 *
 * This prevents horizontal overflow on long abstract-jump chains while keeping
 * short RST chains visually inline.
 */
function ProvenanceChain({ steps }) {
  const [expanded, setExpanded] = useState(false);
  if (!steps || steps.length === 0) return null;
  if (steps.length === 1 && steps[0].stepType === 'SEED') return null;

  const isLong = steps.length >= 3;
  const highestStep = steps.reduce((best, s) => {
    const order = ['ABSTRACT_JUMP','INFERRED_LINK','CONCEPT_BRIDGE','RST_UPWARD','RST_DOWNWARD','SEED'];
    return order.indexOf(s.stepType) < order.indexOf(best?.stepType ?? 'SEED') ? s : best;
  }, null);
  const accentColor = highestStep ? (STEP_TYPE_CONFIG[highestStep.stepType]?.color ?? '#555') : '#555';

  const containerStyle = {
    marginBottom: 6, padding: '4px 8px',
    background: 'rgba(255,255,255,0.03)', borderRadius: 6,
    borderLeft: `2px solid ${accentColor}55`,
  };

  // Short chain: single horizontal row
  if (!isLong) {
    return (
      <div style={{ ...containerStyle, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
        <span style={{ color: '#555', fontSize: 10, marginRight: 2, flexShrink: 0 }}>Provenance</span>
        {steps.map((step, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span style={{ color: '#444', fontSize: 11 }}>→</span>}
            <ProvenanceTag step={step} />
          </React.Fragment>
        ))}
      </div>
    );
  }

  // Long chain: collapsed summary badge → expand to vertical list
  return (
    <div style={containerStyle}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
        onClick={() => setExpanded(e => !e)}
      >
        <span style={{ color: '#555', fontSize: 10, flexShrink: 0 }}>Provenance</span>
        {/* Always show first and last hop as anchors */}
        <ProvenanceTag step={steps[0]} />
        <span style={{ color: '#444', fontSize: 11 }}>→</span>
        <span style={{
          fontSize: 10, color: accentColor,
          background: accentColor + '18', borderRadius: 3, padding: '1px 5px',
        }}>
          {steps.length - 2} more
        </span>
        <span style={{ color: '#444', fontSize: 11 }}>→</span>
        <ProvenanceTag step={steps[steps.length - 1]} />
        <span style={{ color: '#555', fontSize: 10, marginLeft: 4 }}>{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {steps.map((step, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {i > 0 && (
                <span style={{ color: '#333', fontSize: 10, paddingLeft: 8 }}>↳</span>
              )}
              <ProvenanceTag step={step} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Renders a single ProvenanceWrappedUnit block.
 *
 * Expected shape:
 *   { index, role, relation, text, path: { steps: [...] } }
 */
function ContextUnitBlock({ unit, index }) {
  const [collapsed, setCollapsed] = useState(false);
  const hasProvenance = unit.path?.steps?.length > 0
    && !(unit.path.steps.length === 1 && unit.path.steps[0].stepType === 'SEED');

  // Determine accent color from highest-priority step type
  const highestStep = unit.path?.steps?.reduce((best, s) => {
    const order = ['ABSTRACT_JUMP','INFERRED_LINK','CONCEPT_BRIDGE','RST_UPWARD','RST_DOWNWARD','SEED'];
    return order.indexOf(s.stepType) < order.indexOf(best?.stepType ?? 'SEED') ? s : best;
  }, null);
  const accentColor = highestStep ? (STEP_TYPE_CONFIG[highestStep.stepType]?.color ?? '#333') : '#333';

  return (
    <div style={{
      marginBottom: 8, borderRadius: 8,
      border: `1px solid ${hasProvenance ? accentColor + '33' : '#1e1e1e'}`,
      background: '#0d0d0d', overflow: 'hidden',
    }}>
      {/* Header row */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '5px 10px', cursor: 'pointer',
          borderBottom: collapsed ? 'none' : '1px solid #1a1a1a',
          background: hasProvenance ? accentColor + '0a' : 'transparent',
        }}
        onClick={() => setCollapsed(c => !c)}
      >
        <span style={{ color: '#555', fontSize: 10, flexShrink: 0 }}>#{index}</span>
        {unit.role && (
          <Tag style={{ fontSize: 10, margin: 0, lineHeight: '16px' }}
               color={unit.role === 'NUCLEUS' ? 'blue' : unit.role === 'ROOT' ? 'cyan' : 'default'}>
            {unit.role}
          </Tag>
        )}
        {unit.relation && (
          <span style={{ color: '#666', fontSize: 10 }}>{unit.relation}</span>
        )}
        {hasProvenance && (
          <span style={{
            marginLeft: 'auto', fontSize: 10, color: accentColor,
            background: accentColor + '15', borderRadius: 3, padding: '1px 5px',
          }}>
            {STEP_TYPE_CONFIG[highestStep?.stepType]?.label ?? ''}
          </span>
        )}
        <span style={{ color: '#444', fontSize: 10, marginLeft: hasProvenance ? 0 : 'auto' }}>
          {collapsed ? '▶' : '▼'}
        </span>
      </div>

      {!collapsed && (
        <div style={{ padding: '8px 10px' }}>
          {hasProvenance && <ProvenanceChain steps={unit.path.steps} />}
          <div style={{ color: '#d4d4d4', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {unit.text}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Renders a list of ProvenanceWrappedUnit objects passed as structured data.
 * Used when msg.content = { type: 'provenance_context', units: [...] }
 */
function ProvenanceContextView({ units }) {
  if (!units || units.length === 0) return null;
  return (
    <div style={{ padding: '4px 0' }}>
      {units.map((unit, i) => (
        <ContextUnitBlock key={unit.id || i} unit={unit} index={i + 1} />
      ))}
    </div>
  );
}

// =============================================================================
// Provenance text parser
// Parses the annotated plain-text format produced by DiscourseContextBundle.toContextText()
// into structured unit objects for ProvenanceContextView.
//
// Input format (one unit):
//   [Context Unit #4]
//   Provenance: unit-001 -[Abstract Concept: 'Market Volatility']-> (strength: 0.89)
//   [NUCLEUS / cause] The sudden shift...
//
// Robustness design:
//   - Header detection uses a loose regex that tolerates extra whitespace and
//     indentation (the backend renders with depth-proportional "  " prefixes)
//   - Provenance line detection is case-insensitive and tolerates missing spaces
//   - Hop regex allows optional spaces around -[...]-> and (strength:...)
//   - Role/relation line tolerates mixed case and extra whitespace
//   - If a block has no parseable provenance, it is still included as a plain
//     unit (steps=[]) so the text is never silently dropped
//   - If fewer than 2 units parse successfully, returns null so the content
//     falls back to markdown — avoids false positives on short messages
// =============================================================================

// Infer StepType from the bridge label string
function inferStepType(label) {
  const l = label.trim().toLowerCase();
  if (l.startsWith('rst:') || l.startsWith('rst ')) return 'RST_UPWARD';
  if (l.startsWith('abstract concept')) return 'ABSTRACT_JUMP';
  if (l.startsWith('shared concept')) return 'CONCEPT_BRIDGE';
  if (l.startsWith('semantic similarity') || l.startsWith('inferred')) return 'INFERRED_LINK';
  if (l === 'direct retrieval' || l === 'directly retrieved') return 'SEED';
  return 'INFERRED_LINK';
}

function parseProvenanceText(text) {
  if (!text) return null;

  // Loose header detection: allow leading whitespace and optional "Context " prefix
  // Matches: "[Context Unit #4]", "  [Context Unit #12]", "[Unit #4]"
  const HEADER_RE = /^\s*\[(?:Context\s+)?Unit\s*#\s*(\d+)\]/i;

  // Split on any line that looks like a unit header
  const rawBlocks = text.split(/\n(?=\s*\[(?:Context\s+)?Unit\s*#\s*\d+\])/i);

  // If no split happened, try the original exact marker as a last resort
  if (rawBlocks.length <= 1 && !HEADER_RE.test(text)) return null;

  const units = [];

  for (const block of rawBlocks) {
    if (!block.trim()) continue;
    const lines = block.split('\n');

    // Find header line (may be indented)
    let headerIdx = -1;
    let index = null;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(HEADER_RE);
      if (m) { headerIdx = i; index = parseInt(m[1], 10); break; }
    }
    if (headerIdx === -1 || index === null) continue;

    let provenanceLine = null;
    let contentLineIdx = -1;

    for (let i = headerIdx + 1; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l) continue;
      // Case-insensitive, tolerates "Provenance :" with extra space
      if (/^provenance\s*:/i.test(l) && provenanceLine === null) {
        provenanceLine = l.replace(/^provenance\s*:\s*/i, '');
      } else if (contentLineIdx === -1) {
        contentLineIdx = i;
        break;
      }
    }

    // Parse role/relation: tolerates mixed case, optional spaces around /
    // e.g. "[NUCLEUS / cause]", "[nucleus/cause]", "[ROOT]"
    let role = null, relation = null;
    let bodyLines = contentLineIdx >= 0 ? lines.slice(contentLineIdx) : [];
    let firstBodyLine = bodyLines[0]?.trim() ?? '';

    const roleMatch = firstBodyLine.match(/^\[([A-Za-z]+)(?:\s*\/\s*([a-z]+))?\]\s*(.*)/s);
    let bodyText;
    if (roleMatch) {
      role = roleMatch[1].toUpperCase();
      relation = roleMatch[2]?.toLowerCase() ?? null;
      bodyText = (roleMatch[3] + '\n' + bodyLines.slice(1).join('\n')).trim();
    } else {
      bodyText = bodyLines.join('\n').trim();
    }

    // Parse provenance hops — tolerant regex:
    //   optional spaces around -[...]->
    //   optional spaces inside (strength: N)
    //   strength value may be absent (defaults to 1.0)
    const steps = [];
    if (provenanceLine) {
      // Pattern: <fromId> -[<label>]-> (strength: <n>)
      // Also handles: <fromId> -[<label>]-> without strength
      const hopRe = /(\S+)\s*-\[([^\]]+)\]->\s*(?:\(\s*strength\s*:\s*([\d.]+)\s*\))?/g;
      let m;
      while ((m = hopRe.exec(provenanceLine)) !== null) {
        const fromUnitId = m[1];
        const bridgeLabel = m[2].trim();
        const strength = m[3] != null ? parseFloat(m[3]) : 1.0;
        steps.push({ stepType: inferStepType(bridgeLabel), fromUnitId, bridgeLabel, strength });
      }

      // Fallback: if the hop regex matched nothing but the line is non-empty,
      // try to extract at least the label from any [...] bracket in the line
      if (steps.length === 0) {
        const bracketRe = /\[([^\]]+)\]/g;
        let bm;
        while ((bm = bracketRe.exec(provenanceLine)) !== null) {
          const bridgeLabel = bm[1].trim();
          steps.push({ stepType: inferStepType(bridgeLabel), fromUnitId: null, bridgeLabel, strength: 1.0 });
        }
      }
    }

    units.push({ index, role, relation, text: bodyText, path: { steps } });
  }

  // Require at least 2 successfully parsed units to avoid false positives
  return units.length >= 2 ? units : null;
}

function renderContent(content) {
  if (typeof content !== 'string') return null;

  // Try structured code-analysis result (modules/linkages/issues/recommendations)
  const analysis = tryParseAnalysisResult(content);
  if (analysis) {
    return (
      <div>
        {analysis.prefix && <MarkdownContent content={analysis.prefix} />}
        <StructuredAnalysisView data={analysis.parsed} />
        {analysis.suffix && <MarkdownContent content={analysis.suffix} />}
      </div>
    );
  }

  // Detect provenance-annotated context text from DiscourseContextBundle
  const provenanceUnits = parseProvenanceText(content);
  if (provenanceUnits) {
    return <ProvenanceContextView units={provenanceUnits} />;
  }

  if (isHtmlContent(content)) {
    // Unwrap JSON-wrapped HTML: {"html": "<html>..."} → raw HTML
    let html = content;
    try {
      if (html.trim().startsWith('{') && html.includes('"html"')) {
        const parsed = JSON.parse(html);
        if (parsed && typeof parsed.html === 'string') {
          html = parsed.html;
        }
      }
    } catch (e) {
      // Not valid JSON — use as-is
    }
    // Strip markdown code fences if present
    html = html.replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/i, '');

    const styledHtml = `
      <style>
        body { margin: 0; background: #141414; color: #f0f0f0; }
        .wrap { padding: 16px; }
        .title { font-size: 20px; font-weight: 700; margin-bottom: 6px; }
        .sub { color: #9aa0a6; margin-bottom: 14px; font-size: 12px; }
        .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 16px; }
        .card { background: #1d1d1d; border: 1px solid #2a2a2a; border-radius: 10px; padding: 10px 12px; }
        .label { color: #9aa0a6; font-size: 11px; margin-bottom: 6px; }
        .val { font-size: 20px; font-weight: 700; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 12px; margin-bottom: 16px; }
        .panel { background: #1d1d1d; border: 1px solid #2a2a2a; border-radius: 10px; padding: 10px 12px; overflow: hidden; }
        .panelTitle { font-size: 13px; font-weight: 700; margin: 0 0 8px 0; color: #e8eaed; }
        .panelSub { font-size: 11px; color: #9aa0a6; margin: 0 0 10px 0; }
        .chart { width: 100%; height: 320px; }
        .tableWrap { background: #1d1d1d; border: 1px solid #2a2a2a; border-radius: 10px; overflow: auto; }
        table { width: 100%; border-collapse: collapse; min-width: 680px; }
        th, td { padding: 10px; border-bottom: 1px solid #2a2a2a; text-align: left; font-size: 12px; }
        th { position: sticky; top: 0; background: #171717; color: #d7d7d7; }
        .err { color: #ff7875; white-space: pre-wrap; }
        .hint { color: #9aa0a6; font-size: 12px; padding: 10px 12px; }
        .toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
        select { background: #1d1d1d; color: #e8eaed; border: 1px solid #2a2a2a; border-radius: 8px; padding: 8px 10px; font-size: 12px; }
      </style>
      ${html}
    `;
    return (
      <div
        style={{ color: '#e3e3e3', fontSize: 14 }}
        dangerouslySetInnerHTML={{ __html: styledHtml }}
      />
    );
  }

  return <MarkdownContent content={content} />;
}

export default MessageBubble;

