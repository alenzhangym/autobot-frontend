import { resolveAgentColor, AGENT_COLORS_FALLBACK } from '../PlanView'

/**
 * S3: agent color 优先走后端 SubagentSpec.color（N-7），
 * 缺失时退到 AGENT_COLORS_FALLBACK。
 */

describe('S3: resolveAgentColor', () => {
  test('后端 color 优先于 fallback 表', () => {
    expect(resolveAgentColor('LLMAgent', 'volcano')).toBe('volcano')
  })
  test('后端没给 color → 走 fallback 表', () => {
    expect(resolveAgentColor('CodeAgent')).toBe('green')
    expect(resolveAgentColor('CommandAgent')).toBe('orange')
  })
  test('未知 agent → default', () => {
    expect(resolveAgentColor('NewAgentFromBackend')).toBe('default')
  })
  test('agentName 空 / undefined → default', () => {
    expect(resolveAgentColor()).toBe('default')
    expect(resolveAgentColor(null, 'red')).toBe('red')
    expect(resolveAgentColor('', 'red')).toBe('red')
  })
  test('空字符串 colorOverride 不应被采纳 → 退到 fallback', () => {
    expect(resolveAgentColor('CodeAgent', '')).toBe('green')
  })
  test('fallback 表覆盖核心 10 个 agent', () => {
    expect(AGENT_COLORS_FALLBACK.LLMAgent).toBe('blue')
    expect(AGENT_COLORS_FALLBACK.CodeAgent).toBe('green')
    expect(AGENT_COLORS_FALLBACK.PlannerService).toBe('red')
  })
})
