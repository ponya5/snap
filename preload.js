const { contextBridge, ipcRenderer: ipc } = require('electron');
contextBridge.exposeInMainWorld('api', {
  settings: { get: () => ipc.invoke('s:get'), set: v => ipc.invoke('s:set', v), pick: () => ipc.invoke('s:pick') },
  onShot: f => ipc.on('shot', (_e, o) => f(o)),
  copy: url => ipc.send('copy', url),
  save: url => ipc.send('save', url),
  rec: o => ipc.send('rec', o),
  mode: m => ipc.send('mode', m),
  pv: a => ipc.invoke('pv', a),
  cmd: c => ipc.send('cmd', c),
  close: () => ipc.send('close'),
  onStart: f => ipc.on('start', (_e, id) => f(id)),
  onStop: f => ipc.on('stop', f),
  videoDone: (buf, ext) => ipc.send('video', buf, ext),
});
