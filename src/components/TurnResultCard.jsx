import React, { useMemo, useState } from 'react';
import { Tag } from 'antd';
import { DownOutlined, RightOutlined } from '@ant-design/icons';
import { buildTurnSections } from '../utils/cmdBlocks';

/**
 * 一个目标链一张结果卡 (2026-10-07 F67②)
 *
 * <p>真机 2026-10-07 12:35:47~12:36:55 那一轮（库表 messages 里 9941~9948 七条）：用户只说了一句
 * 「编译和运行后端服务」，界面上却出来七个条目 —— 五条各 3.4K 字、开头一字不差的过程正文，
 * 加一条 26 字的「本轮方案已生成，等你确认」，再加最后那句「⚠️ 部分完成」。
 * 前面的过程卡虽然会把连续中间消息收敛成一个 FlowProcessCard，但<b>本轮结束那一条</b>是真实答复，
 * 收敛链在它这里断掉，于是过程与结果分列成多个条目。</p>
 *
 * <p>本组件把"同一个用户回合里的全部 assistant 消息"渲染为一张卡：主体是本轮最终答复（交回给
 * App.jsx 的既有渲染，含 Markdown/代码块/计划卡），其余各段收进一个默认折叠的「本轮过程」区。
 * 各段正文按内容去重 —— 上面那五条同源同句的过程正文在库里是五份，给人看只需要一份，
 * 份数如实标成 ×5；机器块（{@code __CMD__}）不进正文，但归并成一行「本轮下发指令」，
 * 因为"这轮到底让端侧跑了什么"本身就是给人看的事实。</p>
 */

const MAX_SECTION_CHARS = 900;

// 段的标题：取正文第一行（去掉行首的表情与列表符），拿不到就退化成"第 n 段"
const sectionTitle = (text, no) => {
  const first = (text || '').split('\n').map(s => s.trim()).find(s => s.length > 0) || ''
  const cleaned = first.replace(/^[\s·*\->#⚠✅]+/u, '')
  if (!cleaned) return `第 ${no} 段`
  return cleaned.length > 46 ? cleaned.slice(0, 46) + '…' : cleaned
}

export default function TurnResultCard({ msgs, children }) {
  const [open, setOpen] = useState(false);
  const group = useMemo(() => (Array.isArray(msgs) ? msgs : []), [msgs]);
  const { sections, actions, distinctActions } = useMemo(
    () => buildTurnSections(group.slice(0, -1)), [group]);

  if (group.length < 2) return null;

  const foldedRounds = group.length - 1;
  const dupCount = sections.reduce((n, s) => n + s.count - 1, 0);
  const label = open
    ? '收起本轮过程'
    : `本轮过程 (${sections.length} 段${dupCount ? ` · ${foldedRounds} 条` : ''})`;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ marginLeft: 42 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          {sections.length > 0 && (
            <Tag
              style={{ fontSize: 10, margin: 0, cursor: 'pointer', background: '#1f1f1f',
                color: '#91caff', borderColor: '#303030' }}
              onClick={() => setOpen(o => !o)}
            >
              {open ? <DownOutlined style={{ fontSize: 9, marginRight: 4 }} />
                    : <RightOutlined style={{ fontSize: 9, marginRight: 4 }} />}
              {label}
            </Tag>
          )}
          {actions.length > 0 && (
            <Tag style={{ fontSize: 10, margin: 0, background: '#1f1f1f', color: '#8c8c8c',
              borderColor: '#303030' }}
            >
              本轮下发 {actions.length} 条指令: {distinctActions.join(', ')}
            </Tag>
          )}
        </div>
        {open && sections.length > 0 && (
          <div style={{
            background: '#111', border: '1px solid #262626', borderRadius: 12,
            padding: '8px 12px', marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 10,
            maxHeight: 420, overflow: 'auto'
          }}>
            {sections.map(s => (
              <div key={s.no} style={{ background: '#141414', border: '1px solid #262626', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ color: '#8c8c8c', fontSize: 11, marginBottom: 4 }}>
                  {sectionTitle(s.text, s.no)}
                  {s.count > 1 && (
                    <span style={{ marginLeft: 6, color: '#595959' }}>×{s.count} 轮同句</span>
                  )}
                </div>
                <div style={{ color: '#cfcfcf', fontSize: 12, lineHeight: 1.6,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {s.text.length > MAX_SECTION_CHARS ? s.text.slice(0, MAX_SECTION_CHARS) + '…' : s.text}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* 主体交回调用方渲染（沿用既有的气泡及其副面板），这里不另起一份头像 */}
      {children}
    </div>
  );
}
