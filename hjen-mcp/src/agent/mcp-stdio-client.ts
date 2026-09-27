// A tiny MCP stdio CLIENT — spawns an MCP server (e.g. hjen's run.sh) and speaks
// JSON-RPC over its stdio. This is what lets the IN-APP agent (surface ②) drive
// the SAME tools an external agent uses. Zero-dep; runs on Electron's node.

import { spawn, type ChildProcess } from 'node:child_process';

export interface McpTool { name: string; description: string; inputSchema: any }

export class McpStdioClient {
  private srv: ChildProcess | null = null;
  private buf = '';
  private pending = new Map<number, (msg: any) => void>();
  private idc = 0;
  private ready = false;

  constructor(private command: string, private args: string[] = [], private env?: NodeJS.ProcessEnv) {}

  async start(): Promise<void> {
    this.srv = spawn(this.command, this.args, { stdio: ['pipe', 'pipe', 'inherit'], env: this.env ?? process.env });
    this.srv.stdout!.setEncoding('utf8');
    this.srv.stdout!.on('data', (c: string) => {
      this.buf += c;
      let nl: number;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        if (!line) continue;
        let m: any; try { m = JSON.parse(line); } catch { continue; }
        if (m.id != null && this.pending.has(m.id)) { this.pending.get(m.id)!(m); this.pending.delete(m.id); }
      }
    });
    await this.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'hjen-in-app', version: '1' } });
    this.notify('notifications/initialized', {});
    this.ready = true;
  }

  private call(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.srv) return reject(new Error('client not started'));
      const id = ++this.idc;
      this.pending.set(id, (msg) => (msg.error ? reject(new Error(msg.error.message || 'rpc error')) : resolve(msg.result)));
      this.srv.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  private notify(method: string, params?: any): void {
    this.srv?.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  async listTools(): Promise<McpTool[]> {
    const r = await this.call('tools/list', {});
    return (r?.tools ?? []) as McpTool[];
  }
  async callTool(name: string, args: Record<string, unknown>): Promise<{ content: any[]; isError?: boolean }> {
    return await this.call('tools/call', { name, arguments: args });
  }
  isReady(): boolean { return this.ready; }
  stop(): void { try { this.srv?.kill(); } catch { /* ignore */ } this.srv = null; this.ready = false; }
}
