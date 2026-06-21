import { create } from 'zustand'

export const useDataStore = create((set) => ({
  providers: [],
  setProviders: (providers) => set({ providers }),

  selectedProvider: '',
  setSelectedProvider: (provider) => set({ selectedProvider: provider }),

  dbConfigs: [],
  setDbConfigs: (dbConfigs) => set({ dbConfigs }),

  skills: [],
  setSkills: (skills) => set({ skills }),

  companies: [],
  setCompanies: (companies) => set({ companies }),
}))
