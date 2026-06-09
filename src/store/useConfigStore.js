import { create } from 'zustand'

export const useConfigStore = create((set) => ({
  localAgentStatus: 'checking',
  setLocalAgentStatus: (status) => set({ localAgentStatus: status }),

  locale: localStorage.getItem('autobot_lang') || 'zh-CN',
  setLocale: (locale) => { localStorage.setItem('autobot_lang', locale); set({ locale }); },
}))
