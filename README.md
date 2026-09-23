# Taixu Language for Visual Studio Code

太虚语言（Taixu，`.tx`）的 VS Code 扩展——语法高亮、代码片段与语言服务。

> **设计原则：插件端零语言实现。** 诊断、格式化、补全、定义跳转等一切语义
> 能力由 `taixu lsp` 子进程提供（LSP 3.17，stdio 传输），与 `taixu` 命令行
> 完全同引擎。本插件只做编辑器集成，不存在第二套语言实现。

## 前提条件

1. **VS Code** 1.80 及以上；
2. **Node.js 与 npm**——安装依赖与打包扩展时使用；
3. **`taixu` 命令行工具**——语言服务的真正提供者。太虚语言尚在早期开发
   阶段，获取方式请见 [taixu.icu](https://taixu.icu)。没有它，本插件只提供
   语法高亮与片段，不提供诊断等语义功能。

## 安装

### 方式一：打包成 VSIX 安装（推荐）

```bash
git clone https://github.com/yockii/taixu-vscode
cd taixu-vscode
npm install
npx @vscode/vsce package        # 生成 taixu-vscode-0.0.1.vsix
```

然后在 VS Code 中：扩展面板 → 右上角 `…` 菜单 → **从 VSIX 安装…** →
选择生成的 `.vsix` 文件，重载窗口即可。

### 方式二：开发模式加载

```bash
code --extensionDevelopmentPath=/path/to/taixu-vscode
```

适合想改动本扩展的开发者；窗口内自动加载未打包的扩展。

## 配置

安装后打开任意 `.tx` 文件即可。语法高亮与片段立即生效；语言服务需要告诉
插件 `taixu` 可执行文件的位置：

1. VS Code 设置中搜索 `taixu.path`，填入 `taixu` 可执行文件的路径
   （默认 `taixu`，即在 `PATH` 中时可留空）；
2. 修改后语言服务自动重启。

### 排查：语言服务没有启动？

命令面板（`Ctrl+Shift+P`）运行 **Taixu: Check Server**。它会检查：

- `taixu --version` 是否可执行；
- `taixu lsp --stdio` 能否完成 LSP 初始化握手。

结果与详细日志见输出面板中的 **Taixu LSP** 通道。

## 功能

- **语法高亮**：注释/字符串/模板串（`${}` 插值）/数字/类型/关键字
  （含上下文关键字 `async`/`await`/`declare`/`in`）/函数声明/extern 声明；
- **代码片段**：`main`/`fn`/`asyncfn`/`ferr`/`st`/`enu`/`test`/`list`/`spawn`；
- **语言服务**（需配置 `taixu.path`）：诊断推送、hover 类型提示、补全、
  定义跳转、文档格式化。

## 版本适配

| 插件版本 | 要求 | 备注 |
|---|---|---|
| 0.0.1 | 支持 LSP 的 `taixu`（诊断/格式化/符号/hover/补全/定义） | 首版 |

## 暂不支持

- VS Code 扩展市场发布（当前请按上文方式手动安装）；
- 调试器适配（DAP）；
- 语义着色（semantic tokens）——着色目前由 TextMate 文法提供。

## 许可

Apache-2.0 / MIT 双许可（`LICENSE-APACHE` / `LICENSE-MIT`）。
