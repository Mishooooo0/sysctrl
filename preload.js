const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    startAgent: (config) => ipcRenderer.send('start-agent', config),
    stopAgent: () => ipcRenderer.send('stop-agent'),
    onLog: (callback) => ipcRenderer.on('log', (event, ...args) => callback(...args)),
    onStatus: (callback) => ipcRenderer.on('status', (event, status) => callback(status))
});