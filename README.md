# taixu-vscode

太虚语言（Taixu，`.tx`）的 VS Code 插件——**语法高亮＋代码片段＋同引擎 LSP 客户端**。

> **红线：插件端零语言实现副本。** 诊断、格式化、补全、定义跳转——一切语义
> 能力由 [`taixu lsp`](https://github.com/yockii/taixu-project) 子进程提供
> （LSP 3.17 基线，stdio）。本插件只做编辑器集成；不存在第二套语言实现。

## 功能

- **语法高亮**：TextMate 文法——注释/字符串/模板串（`${}` 插值）/数字/类型/
  关键字（含上下文关键字 `async`/`await`/`declare`/`in`）/函数声明/extern 声明；
- **代码片段**：`main`/`fn`/`asyncfn`/`ferr`/`st`/`enu`/`test`/`list`/`spawn`；
- **LSP**（需 `taixu.path` 指向可执行文件）：诊断推送、hover、补全、定义、
  格式化——与 CLI 完全同引擎。

## 安装（本地 load-unpacked）

```bash
cd taixu-vscode
npm install
# VS Code → 扩展面板 → "从 VSIX 安装"旁的命令面板 →
# "Developer: Install Extension from Location..." 指向本目录；
# 或：code --extensionDevelopmentPath=$PWD（扩展开发宿主窗口）
```

设置 `taixu.path`（默认 `taixu`，即在 PATH 中）指向核心仓构建产物
（`taixu-project/zig-out/bin/taixu`）。打开任意 `.tx` 文件即生效。

## 适配版本

| 插件版本 | 适配 taixu 版本 | 备注 |
|---|---|---|
| 0.0.1 | LSP 一期及以上（诊断/格式化/符号/hover/补全/定义） | 首版；async/await 上下文关键字着色 |

核心仓 LSP 能力面变更时会同步核对本仓影响面。

## 不做（一期范围）

vsix 市场发布（本地 load-unpacked 验收即达标）、DAP 调试器适配、语义 token
面 LSP（源面沿用 TextMate）。

## 许可

Apache-2.0 / MIT 双许可（`LICENSE-APACHE` / `LICENSE-MIT`）。
