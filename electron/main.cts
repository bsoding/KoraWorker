import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { Worker } from './worker.cjs'
import * as store from './store.cjs'
import type { CreateJobInput, ProviderInput, WindowAction, WorkerEmit } from '../src/types.js'

let window: BrowserWindow
let worker: Worker

const send: WorkerEmit = (channel, payload) => {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
}

function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    frame: false,
    show: false,
    backgroundColor: '#f7d1c8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  })
  window.webContents.on('will-attach-webview', (_, preferences) => {
    delete preferences.preload
    preferences.nodeIntegration = false
    preferences.contextIsolation = true
    preferences.sandbox = true
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  const devUrl = process.env.KORA_DEV_URL
  if (devUrl) window.loadURL(devUrl)
  else window.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'))
  window.once('ready-to-show', () => window.show())
}

app.whenReady().then(() => {
  worker = new Worker(send)
  createWindow()
  ipcMain.handle('kora:get-state', () => worker.snapshot())
  ipcMain.handle('kora:save-settings', (_, settings: Partial<ProviderInput> | undefined) => {
    const result = store.saveSettings(settings || {})
    worker.broadcast()
    return result
  })
  ipcMain.handle('kora:choose-folder', async () => {
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('kora:create-job', (_, job: Partial<CreateJobInput> | undefined) => worker.createJob(job || {}))
  ipcMain.handle('kora:send-message', (_, message: string) => worker.sendMessage(message))
  ipcMain.handle('kora:wake', () => worker.wake())
  ipcMain.handle('kora:window-action', (_, action: WindowAction) => {
    if (action === 'minimize') window.minimize()
    if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize()
    if (action === 'close') window.close()
  })
  ipcMain.handle('kora:open-external', (_, rawUrl: string) => {
    const url = new URL(rawUrl)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only web links can be opened.')
    return shell.openExternal(url.toString())
  })
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
