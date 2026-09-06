import React, { useMemo, useState } from 'react';
import { Tag, Collapse, Avatar } from 'antd';
import { RobotOutlined, LoadingOutlined } from '@ant-design/icons';
import { CodeAnalysisProgress, formatAnalysisPhase } from '../hooks/useAnalysisProgress.jsx';

/**
 * 流程过程合并卡片 (2026-09-05)
 *
 * <p>会话未得出最终结论前，中间过程会连续产生多条 assistant 中间消息（每轮含
 * __CMD__ 待执行命令 / __state 中间态）。逐条渲染会形成多个占位大卡片、挤占显示空间。
 * 本组件把一段连续中间消息收敛为一个"流程过程"卡片：头部展示阶段/轮次，主体复用
 * 最新一轮的 {@link CodeAnalysisProgress} 进度条，各轮过程文本默认折叠，仅在需要时展开。</p>
 */
export default function FlowProcessCard({ msgs }) {
  const [showDetails, setShowDetails] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  // 最新一轮 AWAITING_COMMANDS 中间态（用于进度条与阶段标签）
  const lastState = useMemo(() => {
    if (!Array.isArray(msgs)) return null;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const st = msgs[i]?.__cmd?.state;
      if (st && typeof st === 'object' && st.__state === 'AWAITING_COMMANDS') return st;
    }
    return null;
  }, [msgs]);

  // 各轮过程文本摘要（默认折叠展示）
  const details = useMemo(() => {
    if (!Array.isArray(msgs)) return [];
    return msgs.map((m, idx) => {
      let text = m?.__cmd?.displayContent || (typeof m?.content === 'string' ? m.content : '');
      // 与 MessageBubble 一致: 剥离【自动上下文投影…投影结束】, 只保留过程正文
      text = (text || '').replace(/【自动上下文投影[\s\S]*?自动上下文投影结束】/g, '').trim();
      return { no: idx + 1, text };
    }).filter(d => d.text);
  }, [msgs]);

  if (!Array.isArray(msgs) || msgs.length === 0) return null;

  const phaseLabel = lastState ? formatAnalysisPhase(lastState.__phase) : '执行中';
  const round = lastState ? Number(lastState.__round || 0) : 0;
  const maxRounds = lastState ? Math.max(1, Number(lastState.__max_rounds || 10)) : 0;

  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
      <Avatar icon={<RobotOutlined />} size={32} style={{ background: '#1677ff', flexShrink: 0 }} />
      <div style={{ flex: 1, maxWidth: 'calc(100% - 50px)', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ color: '#888', fontSize: 12 }}>AutoBot</span>
          <Tag color="purple" style={{ fontSize: 10, margin: 0 }}>
            <LoadingOutlined spin style={{ marginRight: 4 }} />
            流程过程
          </Tag>
          <Tag style={{ fontSize: 10, margin: 0, background: '#1f1f1f', color: '#d9d9d9', borderColor: '#303030' }}>
            {phaseLabel}
          </Tag>
          {round > 0 && (
            <Tag style={{ fontSize: 10, margin: 0, background: '#1f1f1f', color: '#d9d9d9', borderColor: '#303030' }}>
              轮次 {round}/{maxRounds}
            </Tag>
          )}
          {details.length > 0 && (
            <Tag
              style={{ fontSize: 10, margin: 0, cursor: 'pointer', background: '#1f1f1f', color: '#91caff', borderColor: '#303030' }}
              onClick={() => setShowSteps(s => !s)}
            >
              {showSteps ? '收起各轮过程' : `各轮过程 (${details.length})`}
            </Tag>
          )}
        </div>
        <div style={{ background: '#111', borderRadius: 12, padding: '4px 0', minWidth: 0, overflow: 'hidden' }}>
          {lastState && <CodeAnalysisProgress state={lastState} />}
          {!lastState && (
            <div style={{ color: '#a6a6a6', fontSize: 13, padding: '10px 12px' }}>
              正在执行，等待后续结果…
            </div>
          )}
          {showSteps && (
            <div style={{ padding: '0 12px 12px' }}>
              <Collapse
                ghost
                size="small"
                items={[{
                  key: 'flow-steps',
                  label: '各轮过程文本',
                  children: (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflow: 'auto' }}>
                      {details.map(d => (
                        <div key={d.no} style={{ background: '#141414', border: '1px solid #262626', borderRadius: 8, padding: '8px 10px' }}>
                          <div style={{ color: '#8c8c8c', fontSize: 11, marginBottom: 4 }}>第 {d.no} 轮</div>
                          <div style={{ color: '#cfcfcf', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {d.text.length > 500 ? d.text.slice(0, 500) + '…' : d.text}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                }]}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
