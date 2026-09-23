// taixu-vscode DAP 协议桥（TOOL-46；V0.40-D2）。
//
// **红线：插件端零语言实现。** 本文件只做字节级中继——VSCode 调试服务 ⇄
// `taixu dap` 子进程（Content-Length 帧原样透传，不解析、不改写任何 DAP
// 语义）。断点/步进/栈帧/变量的一切语义都在 taixu CLI 的 DAP 服务器里
//（同引擎同权限，与 `taixu run --debug`、MCP 八调试工具同层）。
//
// 可执行解析：环境变量 TAIXU_PATH → PATH 上的 `taixu`。
// 生命周期：VSCode 关闭 stdin（会话结束）→ taixu dap 自收尾退出 → 本进程
// 以其退出码退出；taixu dap 异常退出 → 透传退出码。

const { spawn } = require('child_process');

const exe = process.env.TAIXU_PATH || 'taixu';
const child = spawn(exe, ['dap'], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe'],
});

child.on('error', (err) => {
  process.stderr.write(`taixu debugAdapter: 无法启动 ${exe} dap —— ${err.message}\n`);
  process.exit(1);
});

// VSCode → taixu dap
process.stdin.pipe(child.stdin);
// taixu dap → VSCode
child.stdout.pipe(process.stdout);
// 诊断/告警透传（VSCode 显示为适配器输出）
child.stderr.pipe(process.stderr);

child.on('exit', (code) => {
  process.exit(typeof code === 'number' ? code : 0);
});

process.stdin.on('end', () => {
  // VSCode 侧收流：转闭 taixu dap 的 stdin——其按 EOF 自收尾（D15 会话收尾）。
  child.stdin.end();
});
