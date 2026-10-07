import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { KoraBridge, KoraState, SetupUpdate } from '../src/types.js'

const bridge: KoraBridge = {
  getState: () => ipcRenderer.invoke('kora:get-state'),
  saveSettings: (settings) => ipcRenderer.invoke('kora:save-settings', settings),
  chooseFolder: () => ipcRenderer.invoke('kora:choose-folder'),
  createJob: (job) => ipcRenderer.invoke('kora:create-job', job),
  sendMessage: (message) => ipcRenderer.invoke('kora:send-message', message),
  wake: () => ipcRenderer.invoke('kora:wake'),
  windowAction: (action) => ipcRenderer.invoke('kora:window-action', action),
  openExternal: (url) => ipcRenderer.invoke('kora:open-external', url),
  onState: (callback) => {
    const listener = (_: IpcRendererEvent, value: KoraState) => callback(value)
    ipcRenderer.on('worker:state', listener)
    return () => ipcRenderer.removeListener('worker:state', listener)
  },
  onSetup: (callback) => {
    const listener = (_: IpcRendererEvent, value: SetupUpdate) => callback(value)
    ipcRenderer.on('worker:setup', listener)
    return () => ipcRenderer.removeListener('worker:setup', listener)
  },
}

contextBridge.exposeInMainWorld('kora', bridge)
