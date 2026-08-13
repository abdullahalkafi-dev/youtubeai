import { createSlice } from '@reduxjs/toolkit'

type Theme = 'dark' | 'light' | 'system'

interface UiState {
  theme: Theme
  sidebarOpen: boolean
  mobileSidebarOpen: boolean
  commandPaletteOpen: boolean
  notificationPanelOpen: boolean
}

const initialState: UiState = {
  theme: 'system',
  sidebarOpen: true,
  mobileSidebarOpen: false,
  commandPaletteOpen: false,
  notificationPanelOpen: false,
}

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setTheme(state, action) {
      state.theme = action.payload
    },
    toggleSidebar(state) {
      state.sidebarOpen = !state.sidebarOpen
    },
    toggleMobileSidebar(state) {
      state.mobileSidebarOpen = !state.mobileSidebarOpen
    },
    closeMobileSidebar(state) {
      state.mobileSidebarOpen = false
    },
    toggleCommandPalette(state) {
      state.commandPaletteOpen = !state.commandPaletteOpen
    },
    toggleNotificationPanel(state) {
      state.notificationPanelOpen = !state.notificationPanelOpen
    },
    closeAllPanels(state) {
      state.mobileSidebarOpen = false
      state.commandPaletteOpen = false
      state.notificationPanelOpen = false
    },
  },
})

export const {
  setTheme, toggleSidebar, toggleMobileSidebar, closeMobileSidebar,
  toggleCommandPalette, toggleNotificationPanel, closeAllPanels,
} = uiSlice.actions
export default uiSlice.reducer
