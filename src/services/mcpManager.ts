import { spawn, ChildProcess } from 'child_process';

export interface McpToolDef {
  name: string;
  method?: string;
  description?: string;
  parameters?: any;
}

export interface McpServerConfig {
  id: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string,string>;
  tools?: McpToolDef[];
}

export class McpProcess {
  id: string;
  proc: ChildProcess;
  nextId = 1;
  buffer = '';
  pending = new Map<number, { resolve: (v:any)=>void; reject: (e:any)=>void }>();

  constructor(id: string, proc: ChildProcess) {
    this.id = id;
    this.proc = proc;
    if (!proc.stdout) throw new Error('No stdout');
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      let idx;
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          const { id, result, error } = msg;
          const p = this.pending.get(id);
          if (p) {
            this.pending.delete(id);
            if (error) p.reject(new Error(error.message || 'MCP error'));
            else p.resolve(result);
          }
        } catch {}
      }
    });
  }

  request(method: string, params: any) {
    const id = this.nextId++;
    this.proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('MCP request timeout'));
        }
      }, 20000);
    });
  }

  dispose() {
    try { this.proc.kill(); } catch {}
  }
}

export class McpManager {
  processes = new Map<string, McpProcess>();
  toolIndex = new Map<string, { serverId: string; method: string; def: McpToolDef }>();

  async startServers(configs: McpServerConfig[]) {
    for (const cfg of configs) {
      if (this.processes.has(cfg.id)) continue;
      const proc = spawn(cfg.command, cfg.args || [], { cwd: cfg.cwd || process.cwd(), env: { ...process.env, ...(cfg.env||{}) }, stdio: ['pipe', 'pipe', 'inherit'] });
      const mp = new McpProcess(cfg.id, proc);
      this.processes.set(cfg.id, mp);
      for (const tool of cfg.tools || []) {
        const key = `mcp:${cfg.id}:${tool.name}`;
        this.toolIndex.set(key, { serverId: cfg.id, method: tool.method || tool.name, def: tool });
      }
    }
  }

  listAssistantTools() {
    const tools: any[] = [];
    for (const [key, entry] of this.toolIndex.entries()) {
      tools.push({ type: 'function', function: { name: key, description: entry.def.description || key, parameters: entry.def.parameters || { type: 'object' } } });
    }
    return tools;
  }

  async call(name: string, args: any) {
    const entry = this.toolIndex.get(name);
    if (!entry) throw new Error(`Unknown MCP tool: ${name}`);
    const proc = this.processes.get(entry.serverId);
    if (!proc) throw new Error(`MCP server not running: ${entry.serverId}`);
    return await proc.request(entry.method, args);
  }

  dispose() {
    for (const p of this.processes.values()) p.dispose();
    this.processes.clear();
    this.toolIndex.clear();
  }
}
