import { create } from 'zustand'

export const useAppStore = create((set) => ({
  // User state
  user: null,
  setUser: (user) => set({ user }),

  // Companies & Users Data
  companies: [],
  setCompanies: (companies) => set({ companies }),
  users: [],
  setUsers: (users) => set({ users }),

  // Global UI State
  siderCollapsed: false,
  setSiderCollapsed: (collapsed) => set({ siderCollapsed: collapsed }),
  
  showLogs: true,
  setShowLogs: (show) => set({ showLogs: show }),
  
  showSettings: false,
  setShowSettings: (show) => set({ showSettings: show }),

  showUsersManagement: false,
  setShowUsersManagement: (show) => set({ showUsersManagement: show }),

  showCompanyManagement: false,
  setShowCompanyManagement: (show) => set({ showCompanyManagement: show }),

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

  // Document Preview State
  currentDoc: null,
  setCurrentDoc: (doc) => set({ currentDoc: doc }),
  previewOpen: false,
  setPreviewOpen: (open) => set({ previewOpen: open }),

  // Company Channel Access
  companyChannels: [],
  setCompanyChannels: (channels) => set({ companyChannels: channels }),

  // Skills
  skills: [],
  setSkills: (skills) => set({ skills }),
  locale: localStorage.getItem('autobot_lang') || 'zh-CN',
  setLocale: (locale) => { localStorage.setItem('autobot_lang', locale); set({ locale }); }
}))
