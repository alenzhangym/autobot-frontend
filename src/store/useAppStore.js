import { create } from 'zustand'

// ── Core business state: user, data, system config ──
// UI-only state (modals, panels, display toggles) lives in useUIStore.

export const useAppStore = create((set) => ({
  // User state
  user: null,
  setUser: (user) => set({ user }),

  // Companies & Users Data
  companies: [],
  setCompanies: (companies) => set({ companies }),
  users: [],
  setUsers: (users) => set({ users }),

  // Local Agent Status
  localAgentStatus: 'checking',
  setLocalAgentStatus: (status) => set({ localAgentStatus: status }),

  // Providers & DB Configs
  providers: [],
  setProviders: (providers) => set({ providers }),
  selectedProvider: '',
  setSelectedProvider: (provider) => set({ selectedProvider: provider }),

  dbConfigs: [],
  setDbConfigs: (dbConfigs) => set({ dbConfigs }),

  // Company Channel Access
  companyChannels: [],
  setCompanyChannels: (channels) => set({ companyChannels: channels }),

  // Skills
  skills: [],
  setSkills: (skills) => set({ skills }),
  locale: localStorage.getItem('autobot_lang') || 'zh-CN',
  setLocale: (locale) => { localStorage.setItem('autobot_lang', locale); set({ locale }); }
}))
