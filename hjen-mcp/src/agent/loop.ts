// The in-app agent loop (surface ②). Claude tool-use over the MCP tools: send
// the user's message + the tool schemas to Anthropic; when Claude asks for a
// tool, execute it via the MCP client, feed the result back, repeat until a
// final answer. This is what "talk to HJEN inside the Studio" runs on — the
// SAME tools the external agent uses, so behaviour never diverges.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

export interface AgentTool { name: string; description: string; input_schema: any }
export interface ToolCaller { (name: string, args: Record<string, unknown>): Promise<{ content: any[]; isError?: boolean }> }

export interface AgentDeps {
  anthropicKey: string;
  tools: AgentTool[];
  callTool: ToolCaller;
  model?: string;
  system?: string;
  /** Appended to the base system prompt — used to inject the live surface/project context. */
  systemExtra?: string;
  maxSteps?: number;
  onEvent?: (e: { type: 'tool_call' | 'tool_result' | 'text'; name?: string; args?: any; text?: string }) => void;
}

export interface AgentTurn { finalText: string; steps: Array<{ tool: string; args: any; resultPreview: string; isError?: boolean }>; usage?: any }

const DEFAULT_SYSTEM = `You are the in-app Assistant inside HJEN Studio — a Saudi-DNA KV/film production studio. You drive the studio through the hjen tools.
ORIENT BEFORE ACTING: call hjen_project_overview before acting on a project. Before making any image, load the hjen://dna guidance. House vocabulary: MAKE / FRAME / REFINE — never "generate". NEVER spend money without the user's clear go-ahead: generation tools have a cost guard (confirm:true); surface the estimate and ask first. Keep answers short and concrete.`;

function textOf(content: any[]): string {
  return (content || []).filter((b) => b?.type === 'text').map((b) => b.text).join('').trim();
}
function mcpResultText(res: { content: any[]; isError?: boolean }): string {
  return (res?.content || []).filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
}

export async function runAgentTurn(deps: AgentDeps, userText: string, history: any[] = []): Promise<AgentTurn> {
  const model = deps.model || DEFAULT_MODEL;
  const maxSteps = deps.maxSteps ?? 8;
  const baseSystem = deps.system || DEFAULT_SYSTEM;
  const system = deps.systemExtra ? `${baseSystem}\n\n${deps.systemExtra}` : baseSystem;
  const messages: any[] = [...history, { role: 'user', content: userText }];
  const steps: AgentTurn['steps'] = [];
  let lastUsage: any;

  for (let step = 0; step < maxSteps; step++) {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': deps.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 2048, system, tools: deps.tools, messages }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data: any = await res.json();
    lastUsage = data.usage;
    const content: any[] = data.content || [];
    messages.push({ role: 'assistant', content });

    const toolUses = content.filter((b) => b?.type === 'tool_use');
    const say = textOf(content);
    if (say) deps.onEvent?.({ type: 'text', text: say });

    if (data.stop_reason !== 'tool_use' || toolUses.length === 0) {
      return { finalText: say, steps, usage: lastUsage };
    }

    const toolResults: any[] = [];
    for (const tu of toolUses) {
      deps.onEvent?.({ type: 'tool_call', name: tu.name, args: tu.input });
      let resultText: string; let isError = false;
      try {
        const r = await deps.callTool(tu.name, tu.input || {});
        resultText = mcpResultText(r) || '(no output)';
        isError = !!r.isError;
      } catch (e: any) { resultText = `Error: ${e?.message || e}`; isError = true; }
      steps.push({ tool: tu.name, args: tu.input, resultPreview: resultText.slice(0, 400), isError });
      deps.onEvent?.({ type: 'tool_result', name: tu.name, text: resultText.slice(0, 400) });
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: resultText, is_error: isError });
    }
    messages.push({ role: 'user', content: toolResults });
  }
  return { finalText: '(stopped: max tool steps reached)', steps, usage: lastUsage };
}
