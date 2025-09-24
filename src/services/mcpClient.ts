import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

export class McpClient {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private streamCallbacks = new Map<string, (data: any) => void>();

  async start(workspaceDir: string): Promise<void> {
    if (this.proc) return;
    // Find the extension directory and use the MCP server from there
    const extensionDir = path.dirname(__dirname);
    const serverPath = path.join(extensionDir, '..', 'mcp-server', 'server.js');
    const proc = spawn(process.execPath, [serverPath], {
      env: { ...process.env, WORKSPACE_DIR: workspaceDir },
      stdio: ['pipe', 'pipe', 'inherit']
    });
    this.proc = proc;

    let buffer = '';
    if (!proc.stdout) throw new Error('Failed to start MCP server: no stdout');
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          
          // Handle streaming messages
          if (msg.type === 'stream_output' || msg.type === 'stream_error') {
            const callback = this.streamCallbacks.get(msg.command);
            if (callback) {
              callback(msg);
            }
            continue;
          }
          
          // Handle terminal messages
          if (msg.type === 'terminal_command' || msg.type === 'terminal_output' || msg.type === 'terminal_command_end') {
            const callback = this.terminalCallbacks.get('terminal');
            if (callback) {
              callback(msg);
            }
            continue;
          }
          
          // Handle regular JSON-RPC responses
          const { id, result, error } = msg;
          const pending = this.pending.get(id);
          if (pending) {
            this.pending.delete(id);
            if (error) pending.reject(new Error((error && error.message) || 'MCP error'));
            else pending.resolve(result);
          }
        } catch {
          // ignore malformed lines
        }
      }
    });
  }

  public request(method: string, params: any, timeout: number = 30000): Promise<any> {
    const proc = this.proc;
    if (!proc || !proc.stdin) throw new Error('MCP server not started');
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    proc.stdin.write(payload + '\n');
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP request timeout after ${timeout}ms for method: ${method}`));
        }
      }, timeout);
    });
  }

  readFile(p: string, maxBytes?: number) {
    return this.request('read_file', { path: p, maxBytes });
  }

  searchWorkspace(opts: { root?: string; includeGlobs?: string[]; excludeGlobs?: string[]; query?: string; maxMatches?: number; maxFileBytes?: number; }) {
    return this.request('search_workspace', opts);
  }

  executeCode(code: string, language: string, workingDir?: string) {
    return this.request('execute_code', { code, language, workingDir });
  }

  runCommand(command: string, workingDir?: string, timeout?: number, env?: Record<string, string>) {
    return this.request('run_command', { command, workingDir, timeout, env });
  }

  checkSyntax(filePath: string, language: string) {
    return this.request('check_syntax', { filePath, language });
  }

  installDependencies(packageManager: string = 'npm', workingDir?: string) {
    return this.request('install_dependencies', { packageManager, workingDir });
  }

  buildProject(workingDir?: string, buildCommand?: string) {
    return this.request('build_project', { workingDir, buildCommand });
  }

  testProject(workingDir?: string, testCommand?: string) {
    return this.request('test_project', { workingDir, testCommand });
  }

  lintProject(workingDir?: string, lintCommand?: string) {
    return this.request('lint_project', { workingDir, lintCommand });
  }

  analyzeProject(workingDir?: string) {
    return this.request('analyze_project', { workingDir });
  }

  runReactNative(platform: 'android' | 'ios', workingDir?: string, device?: string) {
    return this.request('run_react_native', { platform, workingDir, device });
  }

  startMetro(workingDir?: string, port?: number) {
    return this.request('start_metro', { workingDir, port });
  }

  installPods(workingDir?: string) {
    return this.request('install_pods', { workingDir });
  }

  cleanReactNative(workingDir?: string) {
    return this.request('clean_react_native', { workingDir });
  }

  runFlutter(platform: 'android' | 'ios' | 'web', workingDir?: string, device?: string) {
    return this.request('run_flutter', { platform, workingDir, device });
  }

  flutterDoctor(workingDir?: string) {
    return this.request('flutter_doctor', { workingDir });
  }

  flutterPubGet(workingDir?: string) {
    return this.request('flutter_pub_get', { workingDir });
  }

  runIonic(platform: 'android' | 'ios' | 'build' | 'serve', workingDir?: string, command?: string) {
    return this.request('run_ionic', { platform, workingDir, command });
  }

  runCordova(platform: 'android' | 'ios' | 'run-android' | 'run-ios' | 'build', workingDir?: string, command?: string) {
    return this.request('run_cordova', { platform, workingDir, command });
  }

  runExpo(command?: string, workingDir?: string) {
    return this.request('run_expo', { workingDir, command });
  }

  listDevices(platform?: 'android' | 'ios' | 'flutter', workingDir?: string) {
    return this.request('list_devices', { workingDir, platform });
  }

  runVSCodeExtension(workingDir?: string) {
    return this.request('run_vscode_extension', { workingDir });
  }

  runProject(workingDir?: string) {
    return this.request('run_project', { workingDir }, 60000); // 60 seconds timeout
  }

  // Stream execution methods
  runCommandStream(command: string, workingDir?: string, timeout?: number, env?: Record<string, string>) {
    return this.request('run_command', { command, workingDir, stream: true, timeout, env });
  }

  runProjectStream(workingDir?: string) {
    return this.request('run_project', { workingDir, stream: true });
  }

  // Stop command execution
  stopCommand(command: string) {
    return this.request('stop_command', { command });
  }
  
  // Stream callback management
  onStreamOutput(command: string, callback: (data: any) => void) {
    this.streamCallbacks.set(command, callback);
  }

  offStreamOutput(command: string) {
    this.streamCallbacks.delete(command);
  }
  
  // Terminal callback management
  private terminalCallbacks = new Map<string, (data: any) => void>();
  
  onTerminalOutput(type: string, callback: (data: any) => void) {
    this.terminalCallbacks.set(type, callback);
  }
  
  offTerminalOutput(type: string) {
    this.terminalCallbacks.delete(type);
  }

  testMcp() {
    return this.request('test_mcp', {});
  }

  dispose() {
    try { this.proc?.kill(); } catch {}
    this.proc = null;
  }
}
