import { create } from 'zustand'

export const useUserStore = create((set) => ({
  user: null,
  setUser: (user) => set({ user }),

  companies: [],
  setCompanies: (companies) => set({ companies }),

  users: [],
  setUsers: (users) => set({ users }),

  companyChannels: [],
  setCompanyChannels: (channels) => set({ companyChannels: channels }),
}))
