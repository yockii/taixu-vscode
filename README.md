# Taixu Language for Visual Studio Code

太虚语言（`.tx`）的 VS Code 扩展：语法高亮、代码片段、原生语言服务与调试。

诊断、格式化、补全、跳转、引用、改名、语义高亮由 `taixu lsp --stdio` 提供；断点、步进、变量由 `taixu dap` 提供。扩展只接编辑器协议，不包含另一套语言实现。

## 安装

需要 VS Code 1.82 以上（与语言客户端依赖的最低版本一致）和支持原生 LSP/DAP 的太虚编译器（获取方式见 [taixu.icu](https://taixu.icu)；没有编译器时只有语法高亮与片段）。Node.js/npm 只在开发、安装依赖和打包时使用，调试直接启动太虚可执行文件。

```sh
npm ci
npx --yes @vscode/vsce@4.0.0 package
```

在扩展面板选择“从 VSIX 安装”，打开生成的 `taixu-vscode-0.0.5.vsix`。VSIX 包含运行依赖，不要加 `--no-dependencies`。扩展市场发布另行安排。

开发加载：

```sh
code --extensionDevelopmentPath=/path/to/taixu-vscode
```

## 编译器配置

在设置中配置 `taixu.path`，语言服务和调试使用同一个可执行文件。路径包含空格、中文或 `&` 时直接填写完整路径，不加 shell 引号。

```json
{
  "taixu.path": "D:/tools/taixu/taixu.exe"
}
```

留空时依次取 `TAIXU_PATH` 环境变量、PATH 中的 `taixu`。命令名只在 PATH 的绝对目录中查找，不在工作区目录里查找；含路径分隔符的相对路径被拒绝。语言服务对每个本地工作区文件夹传 `--workspace`。未受信任的工作区不读取工作区级 `taixu.path`，只用用户级设置。修改配置后语言服务自动停止旧进程并重启；已有调试会话使用启动时的编译器，新会话使用新配置。

命令面板中的 **Taixu: Check Server** 检查 `--version`、完整 LSP initialize 回复及 shutdown/exit。结果见 **Taixu LSP** 输出通道。

## 调试

在工作区 `.vscode/launch.json` 添加：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "taixu",
      "request": "launch",
      "name": "调试 Taixu 程序",
      "program": "${workspaceFolder}/main.tx",
      "cwd": "${workspaceFolder}",
      "args": []
    }
  ]
}
```

设置行断点后按 F5。原生 DAP 在进程内编译带调试插桩的程序，通过控制通道执行；支持运行中替换断点、暂停、步入/步过/步出、调用栈、具名局部变量、槽位及对象展开，调试控制台接收程序输出。运行已有普通 exe 的 DWARF/PDB 调试另行安排。

编译器须正确实现 DAP `initialize`：能力直接位于回复 `body`，包括 `supportsConfigurationDoneRequest`。旧版错误的 `body.capabilities` 会导致编辑器一直等待；遇到此情况请更新编译器。

## 验证

```powershell
$env:VSCODE_EXECUTABLE = '<VS Code 可执行文件的绝对路径>'
$env:TAIXU_TEST_COMPILER = '<taixu 可执行文件的绝对路径>'
npm run test:editor
```

Linux 上可用 `xvfb-run -a npm run test:editor`；两个环境变量同样指向本机可执行文件。容器须有负责回收已退出进程的 init（例如 Docker 的 `--init`，或 `tini -s -- xvfb-run -a npm run test:editor`）。测试在独立 profile 和含中文/空格的工作区中启动真实 VS Code，覆盖语言服务、Unicode 位置、跨文件改名与保存、配置重启、进程收尾及原生断点调试。结果放在忽略目录 `.vscode-test/`（只保留最近三次运行），不改日常编辑器配置。

## 版本适配

| 扩展版本 | 说明 |
|---|---|
| 0.0.1 | LSP 客户端 |
| 0.0.2 | 增加 DAP 字节桥 |
| 0.0.3 | CI 打包点验版 |
| 0.0.4 | 直接启动原生 DAP，统一编译器路径、串行重启、完整握手自检与真实编辑器回归 |
| 0.0.5 | 编译器只按绝对路径或 PATH 解析、按工作区文件夹授权、未受信任工作区限制、启动超时与进程收尾加固 |

Apache-2.0 / MIT 双许可。
