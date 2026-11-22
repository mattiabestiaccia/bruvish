const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('lavishApp', Object.freeze({
  catalog: () => ipcRenderer.invoke('lavish:catalog'),
  snapshot: () => ipcRenderer.invoke('lavish:snapshot'),
  preferences: settings => ipcRenderer.invoke('lavish:preferences', settings),
  mark: request => ipcRenderer.invoke('lavish:mark', request),
  createFolder: name => ipcRenderer.invoke('lavish:create-folder', name),
  assignFolder: request => ipcRenderer.invoke('lavish:assign-folder', request),
  fileAction: request => ipcRenderer.invoke('lavish:file-action', request),
  openReview: key => ipcRenderer.invoke('lavish:open-review', key),
  chooseFile: () => ipcRenderer.invoke('lavish:choose-file'),
  select: id => ipcRenderer.invoke('lavish:select', id),
  close: id => ipcRenderer.invoke('lavish:close', id),
  home: () => ipcRenderer.invoke('lavish:home'),
  reviewAction: action => ipcRenderer.invoke('lavish:review-action', action),
  onChange: callback => {const listener = (_event, value) => callback(value);ipcRenderer.on('lavish:changed', listener);return () => ipcRenderer.removeListener('lavish:changed', listener);}
}));
