const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('opapDesktop', {
  isStandaloneDesktop: true,
  platform: process.platform,
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  getLanIp: () => ipcRenderer.invoke('get-lan-ip'),
  copyLanLink: () => ipcRenderer.invoke('copy-lan-link'),
  showLanInfo: () => ipcRenderer.invoke('show-lan-info'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  setPipState: (state) => ipcRenderer.invoke('set-pip-state', state),
  setWindowSize: (size) => ipcRenderer.invoke('set-window-size', size),
  wakeDisplay: () => ipcRenderer.invoke('wake-display'),
  releaseDisplay: () => ipcRenderer.invoke('release-display'),
  getPeers: () => ipcRenderer.invoke('get-peers'),
  addPeer: (ip, port) => ipcRenderer.invoke('add-peer', { ip, port }),
  scanNetworkSubnet: () => ipcRenderer.invoke('scan-network-subnet'),
  getStationNetworkInfo: () => ipcRenderer.invoke('get-station-network-info'),
  authorizeFirewall: () => ipcRenderer.invoke('authorize-firewall'),
  getNetworkProfile: () => ipcRenderer.invoke('get-network-profile'),
  fixNetworkProfile: () => ipcRenderer.invoke('fix-network-profile'),
  saveStationProfile: (profile) => ipcRenderer.invoke('save-station-profile', profile),
  getStationProfile: () => ipcRenderer.invoke('get-station-profile'),
  onPipCollapse: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('pip-collapse', handler)
    return () => ipcRenderer.removeListener('pip-collapse', handler)
  },
  onWindowSizeChanged: (callback) => {
    const handler = (event, size) => callback(size)
    ipcRenderer.on('window-size-changed', handler)
    return () => ipcRenderer.removeListener('window-size-changed', handler)
  },
})
