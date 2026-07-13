import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('braincells', {
  getSessions: () => ipcRenderer.invoke('sessions:get'),
  terminal: {
    launch: (opts: { cwd?: string }) => ipcRenderer.invoke('terminal:launch', opts),
    reconnect: (opts: { sessionId: string | null; cwd: string }) =>
      ipcRenderer.invoke('terminal:reconnect', opts),
  },
  wired: {
    list: () => ipcRenderer.invoke('wired:list'),
    send: (key: string, text: string) => ipcRenderer.invoke('wired:send', { key, text }),
  },
  shim: {
    status: () => ipcRenderer.invoke('shim:status'),
    install: () => ipcRenderer.invoke('shim:install'),
    uninstall: () => ipcRenderer.invoke('shim:uninstall'),
  },
  win: {
    setContentSize: (width: number, height: number) =>
      ipcRenderer.invoke('window:setContentSize', { width, height }),
  },
});
