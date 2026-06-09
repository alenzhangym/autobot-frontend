import { Tag, Collapse } from 'antd';
import { decodeStateStringList } from '../utils/helpers.jsx';

/**
 * Map backend phase names to human-readable labels.
 */
export function formatAnalysisPhase(phase) {
  switch ((phase || '').trim()) {
    case 'sync_tree':
      return '同步目录';
    case 'bootstrap_scan':
      return '分层扫描';
    case 'initial_read':
      return '读取核心代码';
    case 'focused_read':
      return '精准补片段';
    case 'iterative_read':
      return '继续补证据';
    default:
      return '分析中';
  }
}

/**
 * Estimate analysis progress (0-100) from round state.
 */
export function estimateAnalysisProgress(state) {
  if (!state) return 0;
  const phase = (state.__phase || '').trim();
  const round = Number(state.__round || 0);
  const maxRounds = Math.max(1, Number(state.__max_rounds || 10));
  const roundRatio = Math.min(1, Math.max(0, round / maxRounds));
  const signals = state.__convergence_signals || {};
  const newReads = Number(signals.new_reads_this_round || 0);
  const newCommands = Number(signals.new_commands_this_round || 0);
  const stuck = round > 3 && newReads === 0 && newCommands === 0;
  const stuckBoost = stuck ? 0.15 : 0;
  switch (phase) {
    case 'sync_tree':
      return 8;
    case 'bootstrap_scan':
      return 18;
    case 'initial_read':
      return Math.min(38, 24 + Number(state.__read_count || 0) * 3);
    case 'focused_read':
      return Math.min(72, 50 + Number(state.__read_count || 0) * 2);
    case 'iterative_read':
      return Math.min(95, Math.round((roundRatio + stuckBoost) * 100));
    default:
      return Math.min(90, Math.round((roundRatio + stuckBoost) * 100));
  }
}

/**
 * Progress bar + metadata for in-progress code analysis rounds.
 * Extracted from MessageBubble so the component only handles display.
 */
export function CodeAnalysisProgress({ state }) {
  if (!state || state.__state !== 'AWAITING_COMMANDS') return null;
  const progress = estimateAnalysisProgress(state);
  const phaseLabel = formatAnalysisPhase(state.__phase);
  const round = Number(state.__round || 0);
  const maxRounds = Math.max(1, Number(state.__max_rounds || 10));
  const readCount = Number(state.__read_count || 0);
  const retainedCount = Number(state.__retained_context_count || 0);
  const pendingCommands = Number(state.__pending_commands || 0);
  const completedFiles = decodeStateStringList(state.__completed_read_files);
  const recentReadFiles = decodeStateStringList(state.__recent_read_files);
  const fallbackReadFiles = completedFiles.length > 0 ? completedFiles : decodeStateStringList(state.__read);
  const readFiles = fallbackReadFiles.slice().reverse();

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
          const sig = state.__convergence_signals;
          const newReads = Number(sig.new_reads_this_round || 0);
          const newCmds = Number(sig.new_commands_this_round || 0);
          const stuck = round > 3 && newReads === 0 && newCmds === 0;
          if (stuck) {
            return <Tag color="orange" style={{ margin: 0 }}>收敛中（无新进展）</Tag>;
          }
          if (newReads > 0 || newCmds > 0) {
            return <Tag color="cyan" style={{ margin: 0 }}>本轮 +{newReads}读 / +{newCmds}指令</Tag>;
          }
          return null;
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
            items={[{
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
            }]}
          />
        </div>
      )}
    </div>
  );
}
