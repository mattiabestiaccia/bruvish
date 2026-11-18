const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('lavishApp', Object.freeze({
  catalog: () => ipcRenderer.invoke('lavish:catalog'),
  snapshot: () => ipcRenderer.invoke('lavish:snapshot'),
  preferences: settings => ipcRenderer.invoke('lavish:preferences', settings),
  mark: request => ipcRenderer.invoke('lavish:mark', request),
  fileAction: request => ipcRenderer.invoke('lavish:file-action', request),
  openReview: key => ipcRenderer.invoke('lavish:open-review', key),
  chooseFile: () => ipcRenderer.invoke('lavish:choose-file'),
  select: id => ipcRenderer.invoke('lavish:select', id),
  close: id => ipcRenderer.invoke('lavish:close', id),
  home: () => ipcRenderer.invoke('lavish:home'),
  reviewAction: action => ipcRenderer.invoke('lavish:review-action', action),
  fullscreenImage: () => ipcRenderer.invoke('lavish:fullscreen-image'),
  onChange: callback => {const listener = (_event, value) => callback(value);ipcRenderer.on('lavish:changed', listener);return () => ipcRenderer.removeListener('lavish:changed', listener);}
}));
