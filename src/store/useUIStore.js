import { create } from 'zustand'

// ── UI-only state: modals, panels, display preferences ──
// Separated from business-data stores to keep UI concerns
// independently maintainable and to avoid unnecessary re-renders.

export const useUIStore = create((set) => ({
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

  // Document Preview State
  currentDoc: null,
  setCurrentDoc: (doc) => set({ currentDoc: doc }),
  previewOpen: false,
  setPreviewOpen: (open) => set({ previewOpen: open }),
}))
