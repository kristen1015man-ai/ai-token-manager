"use strict";
// preload：在隔离上下文里向远程 Studio 页面暴露受限 API。
// sandbox:true + contextIsolation:true + nodeIntegration:false —— 三重隔离，
// 远程页面拿不到 Node/Electron 能力，只能通过 contextBridge 访问显式暴露的接口。

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sparkloomDesktop", {
  version: "0.1.0",
  // 弹原生文件夹选择对话框，返回选中目录绝对路径；用户取消返回 null。
  // 主进程 handler：见 main/index.cjs 的 sparkloom:open-directory。
  openDirectory: () => ipcRenderer.invoke("sparkloom:open-directory"),
  // sandbox 下 process 等 Node API 受限；如需 platform 等信息，走 IPC 从主进程取。
  // Phase 2/3 在此扩展：检查更新、本机 Agent 配置状态等
});
