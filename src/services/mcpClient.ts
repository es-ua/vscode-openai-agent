import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

export class McpClient {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();

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

  public request(method: string, params: any): Promise<any> {
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
          reject(new Error('MCP request timeout'));
        }
      }, 15000);
    });
  }

  readFile(p: string, maxBytes?: number) {
    return this.request('read_file', { path: p, maxBytes });
  }

  searchWorkspace(opts: { root?: string; includeGlobs?: string[]; excludeGlobs?: string[]; query?: string; maxMatches?: number; maxFileBytes?: number; }) {
    return this.request('search_workspace', opts);
  }

  dispose() {
    try { this.proc?.kill(); } catch {}
    this.proc = null;
  }
}
