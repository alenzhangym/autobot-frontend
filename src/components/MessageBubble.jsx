import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Avatar, Button, Tooltip, Space, Tag, Collapse } from 'antd';
import { RobotOutlined, UserOutlined, CopyOutlined, CheckOutlined, CloseOutlined, ReloadOutlined, ExpandAltOutlined, LoadingOutlined, ClockCircleOutlined, ApartmentOutlined, LinkOutlined, BranchesOutlined, NodeIndexOutlined, ShareAltOutlined, DeleteOutlined, AppstoreOutlined, ExclamationCircleOutlined, BulbOutlined } from '@ant-design/icons';
import { useState, useEffect, useMemo, useRef } from 'react';
import { extractDataStoreIds, isValidDataStoreResponse, fetchMissingDataFromServer, injectDataStoreData, decodeHtmlEntities, cleanScriptSrc, wrapUiHtml, isHtmlContent, MarkdownContent, extractTrailingStateJson, stripAgentMarkers, extractAnalysisState, tryParseAnalysisResult, decodeStateStringList } from '../utils/helpers.jsx';
import { formatAnalysisPhase, CodeAnalysisProgress } from '../hooks/useAnalysisProgress.jsx';
import FixIssueCard from './FixIssueCard';

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
 * Normalise a message's timestamp into a short display string.
 *
 * Accepts any of:
 *   - `msg.timestamp`  — string ISO, millis, or seconds
 *   - `msg.createdAt`  — string ISO (Jackson default for `LocalDateTime`)
 *   - `msg.created_at` — snake_case variant
 *
 * Returns "HH:MM" for today, "MM-DD HH:MM" for older messages,
 * or `null` if no parseable timestamp is present.
 */
function formatMessageTime(msg) {
  if (!msg) return null
  const raw = msg.timestamp ?? msg.createdAt ?? msg.created_at
  if (raw == null || raw === '') return null
  let d
  if (typeof raw === 'number') {
    // Heuristic: > 1e12 means millis, otherwise seconds
    d = new Date(raw > 1e12 ? raw : raw * 1000)
  } else {
    d = new Date(raw)
  }
  if (isNaN(d.getTime())) return null
  const pad = (n) => String(n).padStart(2, '0')
  const hh = pad(d.getHours())
  const mm = pad(d.getMinutes())
  const now = new Date()
  const sameDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate()
  return sameDay ? `${hh}:${mm}` : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hh}:${mm}`
}

/**
 * Renders the trailing "java-backend/.../X.java [已证实]" style evidence
 * as a monospaced path tag plus a green confirmation tag when present.
 */
function EvidenceTag({ text }) {
  // C1 fix: cache the regex parse. EvidenceTag is a leaf used in long
  // conversation lists; without useMemo the regex re-runs on every parent
  // re-render even when `text` is unchanged.
  const parsed = React.useMemo(() => {
    if (!text) return null;
    const m = String(text).match(/^(.*?)(\s*\[(已证实|confirmed|✓)\])?$/i);
    const path = m ? m[1].trim() : String(text).trim();
    const confirmed = !!(m && m[3]);
    return { path, confirmed };
  }, [text]);
  if (!parsed) return null;
  const { path, confirmed } = parsed;
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
  const [injectedHtml, setInjectedHtml] = useState(null);
  
  const isUser = msg.role === 'user';
  const isPlan = msg.role === 'plan';

  // ── Graceful degradation: keep last valid parse results ──
  // When a new message's JSON is truncated/malformed, parsing returns null.
  // Without a cache, child components (CodeAnalysisProgress, EvidenceTags)
  // would disappear from the DOM entirely. By retaining the last valid state,
  // the UI stays stable — progress bars persist, tags remain visible.
  const lastValidState = useRef(null)
  const lastValidResult = useRef(null)

  const analysisState = useMemo(() => {
    const parsed = msg.__cmd?.state || (typeof msg.content === 'string' ? extractAnalysisState(msg.content) : null)
    if (parsed) {
      lastValidState.current = parsed
      return parsed
    }
    // If msg.__cmd exists but state is null, _parseErrors may explain why.
    // Degrade gracefully: keep the previous valid state instead of null.
    if (msg.__cmd && !msg.__cmd.state && lastValidState.current) {
      return lastValidState.current
    }
    return null
  }, [msg.__cmd?.state, msg.content]);

  const strippedContent = useMemo(
    () => msg.__cmd?.displayContent || (typeof msg.content === 'string' ? stripAgentMarkers(msg.content) : null),
    [msg.__cmd?.displayContent, msg.content]
  );

  const analysisResult = useMemo(() => {
    const parsed = msg.__cmd?.analysisResult
    if (parsed) {
      lastValidResult.current = parsed
      return parsed
    }
    if (msg.__cmd && !msg.__cmd.analysisResult && lastValidResult.current) {
      return lastValidResult.current
    }
    return null
  }, [msg.__cmd?.analysisResult]);

  const handleCopy = () => {
    if (onCopy) onCopy(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Process uiContent - must be before early returns
  const isUiRender = msg.role === 'ui_render' || (msg.content && typeof msg.content === 'object' && msg.content.type === 'ui_render');
  let uiContent = null;
  if (isUiRender) {
    if (typeof msg.content === 'string') {
      uiContent = msg.content;
    } else if (msg.content && typeof msg.content === 'object') {
      uiContent = msg.content.content || msg.content.html || JSON.stringify(msg.content);
    }
  }

  // useEffect for uiContent - must be before early returns
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

  // useEffect for fullscreen - must be before early returns
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  // Early returns
  if (isPlan && msg.content && msg.content.plan) {
    return (
      <PlanMessage content={msg.content} onDelete={onDelete} msgId={msg.id} msg={msg} />
    );
  }

  // Fix-issue inline card. The backend inserts a placeholder
  // message with meta.type="fix_issue" when the user clicks
  // "开始修复" and overwrites the same row (meta.type=
  // "fix_summary") once the driver reaches COMPLETED/FAILED.
  // Render as a dedicated card so the placeholder ("正在修
  // 复…") and the terminal verdict (file list + diff) look
  // continuous as the row updates, instead of the user
  // seeing two unrelated text blobs.
  if (msg && typeof msg.meta === 'string'
      && (msg.meta.includes('"fix_issue"') || msg.meta.includes('"fix_summary"'))) {
    return (
      <div data-msg-id={msg.id} data-msg-role={msg.role}
        data-msg-meta-fix={msg.meta.includes('"fix_issue"') ? 'fix_issue' : 'fix_summary'}
        style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <Avatar icon={<RobotOutlined />} size={32} style={{ background: '#1677ff', flexShrink: 0 }} />
        <div style={{ flex: 1, maxWidth: 'calc(100% - 50px)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ color: '#888', fontSize: 12 }}>AutoBot</span>
            {formatMessageTime(msg) && (
              <span style={{ color: '#555', fontSize: 11 }}>{formatMessageTime(msg)}</span>
            )}
            <Tag color="purple" style={{ fontSize: 10 }}>Fix</Tag>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              {onDelete && msg.id && (
                <Tooltip title="Delete">
                  <Button type="text" icon={<DeleteOutlined />} size="small" onClick={onDelete} style={{ color: '#666' }} />
                </Tooltip>
              )}
            </div>
          </div>
          <FixIssueCard msg={msg} />
        </div>
      </div>
    );
  }

  if (uiContent) {
    const iframeDoc = injectedHtml || uiContent;
    return (
      <>
        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          <Avatar icon={<RobotOutlined />} size={32} style={{ background: '#1677ff', flexShrink: 0 }} />
          <div style={{ flex: 1, maxWidth: 'calc(100% - 50px)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ color: '#888', fontSize: 12 }}>AutoBot</span>
              {formatMessageTime(msg) && (
                <span style={{ color: '#555', fontSize: 11 }}>{formatMessageTime(msg)}</span>
              )}
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
      <div style={{ maxWidth: 'calc(100% - 50px)', flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ color: '#888', fontSize: 12 }}>{isUser ? 'You' : 'AutoBot'}</span>
          {formatMessageTime(msg) && (
            <span style={{ color: '#555', fontSize: 11 }}>{formatMessageTime(msg)}</span>
          )}
          {!isUser && msg.model && <Tag style={{ fontSize: 10, margin: 0 }}>{msg.model}</Tag>}
          {!isUser && msg.__cmd?._parseErrors && (
            <Tooltip
              title={msg.__cmd._parseErrors.map((e, i) => (
                <div key={i} style={{ marginBottom: 4 }}>
                  <strong>{e.field}:</strong> {e.error}
                </div>
              ))}
              overlayStyle={{ maxWidth: 360 }}
            >
              <Tag color="warning" style={{ fontSize: 10, margin: 0, cursor: 'help' }}>
                <ExclamationCircleOutlined style={{ marginRight: 2 }} />
                parse issues ({msg.__cmd._parseErrors.length})
              </Tag>
            </Tooltip>
          )}
        </div>
        <div style={{ 
          background: isUser ? '#1a1a1a' : '#111', 
          borderRadius: 12, 
          padding: isUser ? '12px 16px' : '4px 0',
          border: isUser ? '1px solid #2a2a2a' : 'none',
          minWidth: 0,
          overflow: 'hidden'
        }}>
          {msg.code && msg.code !== msg.content ? (
            <div style={{ marginBottom: 8 }}>
              <pre style={{ background: '#1e1e1e', padding: 12, borderRadius: 8, overflow: 'auto', fontSize: 12, margin: 0 }}>
                <code>{msg.code}</code>
              </pre>
            </div>
          ) : null}
          {!isUser && analysisState && <CodeAnalysisProgress state={analysisState} />}
          {strippedContent && renderContent(strippedContent, analysisResult)}
          {msg.content && typeof msg.content === 'object' && !msg.content.plan && (
            msg.content.type === 'provenance_context'
              ? <ProvenanceContextView units={msg.content.units} />
              : <div style={{ color: '#e3e3e3', fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
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

function PlanMessage({ content, onDelete, msgId, msg }) {
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
    <div style={{ display: 'flex', gap: 10, marginBottom: 20, minWidth: 0 }}>
      <Avatar icon={<RobotOutlined />} size={32} style={{ background: '#1677ff', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ color: '#888', fontSize: 12 }}>AutoBot</span>
          {formatMessageTime(msg) && (
            <span style={{ color: '#555', fontSize: 11 }}>{formatMessageTime(msg)}</span>
          )}
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
          
          <Collapse ghost style={{ minWidth: 0 }}>
            {plan.map((step, idx) => {
              const stepKey = `step-${idx}`;
              const isExpanded = expandedSteps[stepKey];
              
              return (
                <Collapse.Panel
                  key={stepKey}
                  header={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flexWrap: 'wrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                        {getStatusIcon(step.status)}
                        <span style={{ color: getStatusColor(step.status), fontWeight: 500 }}>
                          Step {step.step || idx + 1}
                        </span>
                      </span>
                      <Tag style={{ fontSize: 10, flexShrink: 0, margin: 0 }}>{step.agent}</Tag>
                      <span style={{
                        color: '#888',
                        fontSize: 12,
                        flex: '1 1 100%',
                        minWidth: 0,
                        wordBreak: 'break-all',
                        overflowWrap: 'anywhere',
                        display: 'block'
                      }}>
                        {step.goal}
                      </span>
                    </div>
                  }
                >
                  <div style={{ padding: '8px 0', minWidth: 0, overflow: 'hidden' }}>
                    <div style={{ marginBottom: 12, minWidth: 0 }}>
                      <span style={{ color: '#888', fontSize: 11, fontWeight: 600 }}>Goal</span>
                      <div style={{ color: '#e3e3e3', fontSize: 13, wordBreak: 'break-all', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap', maxWidth: '100%' }}>{step.goal}</div>
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
                      <div style={{ marginBottom: 12, minWidth: 0 }}>
                        <span style={{ color: '#888', fontSize: 11, fontWeight: 600 }}>Thought</span>
                        <div style={{ color: '#aaa', fontSize: 12, fontStyle: 'italic', whiteSpace: 'pre-wrap', wordBreak: 'break-all', overflowWrap: 'anywhere' }}>
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

function renderContent(content, preParsedAnalysis) {
  if (typeof content !== 'string') return null;

  // Try structured code-analysis result (modules/linkages/issues/recommendations)
  // Use pre-parsed data from normalization when available (avoids re-parsing)
  const analysis = preParsedAnalysis || tryParseAnalysisResult(content);
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
    // ... existing HTML handling ...
    let html = content;
    try {
      if (html.trim().startsWith('{') && html.includes('"html"')) {
        const parsed = JSON.parse(html);
        if (parsed && typeof parsed.html === 'string') {
          html = parsed.html;
        }
      }
    } catch (e) {}
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

  // If content appears to be JSON (not handled by tryParseAnalysisResult),
  // wrap it in a code fence so it renders with syntax highlighting instead
  // of plain unformatted text.
  if (looksLikeJsonBlob(content)) {
    return <MarkdownContent content={'```json\n' + content + '\n```'} />;
  }

  return <MarkdownContent content={content} />;
}

/**
 * Heuristic: does the content appear to be primarily a JSON blob?
 * True when the trimmed content starts with { or [ and the first/last
 * braces are balanced at the top level.
 */
function looksLikeJsonBlob(content) {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  // Quick balance check: count { } or [ ] in the first 2000 chars
  const sample = trimmed.slice(0, 2000);
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let i = 0; i < sample.length; i++) {
    const ch = sample[i];
    if (escaping) { escaping = false; continue; }
    if (ch === '\\') { escaping = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
  }
  return depth === 0;
}

export default React.memo(MessageBubble);

