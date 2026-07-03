Sparkloom Agent Windows 使用说明

先做这一步：
1. 不要直接在压缩包预览里运行。
2. 右键下载的 zip 文件，选择“全部解压”。
3. 打开解压后的文件夹。

第一次使用：
1. 双击 1-install-windows.cmd。
2. 如果 Windows 弹出确认，请允许。
3. 等待它检查或安装 Node.js、Git、Python、Sparkloom Agent SDK。
4. 看到 Sparkloom Agent 运行在 http://127.0.0.1:39271 后，不要关闭这个窗口。
5. 打开 https://ai.seapllo.com/studio。
6. 在 Studio 里刷新 Agent 状态，然后创建 Studio Key，并写入本机配置。

以后使用：
1. 双击 2-start-windows.cmd。
2. 保持窗口打开。
3. 打开 https://ai.seapllo.com/studio 使用。

如果打不开：
1. 确认已经“全部解压”，不是在压缩包里面运行。
2. 关闭窗口后重新双击 2-start-windows.cmd。
3. 如果提示 node、npm、git 或 Sparkloom Agent SDK 不可用，重新双击 1-install-windows.cmd。
4. 如果刚安装完工具仍然检测不到，重启电脑后再双击 2-start-windows.cmd。

安全说明：
- 这里填写的是 Sparkloom 页面新建的 sk-emp-... 密钥。
- 不要填写 DeepSeek、硅基流动、OpenAI 或 Anthropic 官方密钥。
- Agent 只监听本机 127.0.0.1，不对公网开放。
