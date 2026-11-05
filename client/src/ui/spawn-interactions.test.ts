import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DictationButton } from './dictation';
import { SpawnPanel } from './spawn';

/** DOM mínimo para clicar nos componentes sem abrir um navegador nos testes de Node. */
class ElementStub {
  children: Array<ElementStub | string> = [];
  className = '';
  textContent = '';
  innerHTML = '';
  hidden = false;
  disabled = false;
  value = '';
  style: Record<string, string> = {};
  private attrs = new Map<string, string>();
  private events = new Map<string, Array<() => void>>();
  classList = {
    contains: (name: string) => this.className.split(' ').includes(name),
    add: (name: string) => { if (!this.classList.contains(name)) this.className += ` ${name}`; },
    remove: (name: string) => { this.className = this.className.split(' ').filter((c) => c !== name).join(' '); },
    toggle: (name: string, on: boolean) => { if (on) this.classList.add(name); else this.classList.remove(name); },
  };

  append(...children: Array<ElementStub | string>): void { this.children.push(...children); }
  replaceChildren(...children: Array<ElementStub | string>): void { this.children = children; }
  addEventListener(event: string, handler: () => void): void {
    this.events.set(event, [...(this.events.get(event) ?? []), handler]);
  }
  fire(event: string): void { this.events.get(event)?.forEach((handler) => handler()); }
  setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
  matches(selector: string): boolean { return selector === ':popover-open' && this.classList.contains('is-open'); }
  focus(): void {}
  getBoundingClientRect(): { bottom: number; right: number } { return { bottom: 10, right: 20 }; }
  querySelector(selector: string): ElementStub | null { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector: string): ElementStub[] {
    const matches = (el: ElementStub) => selector.startsWith('.') && el.classList.contains(selector.slice(1));
    const out: ElementStub[] = [];
    for (const child of this.children) {
      if (typeof child === 'string') continue;
      if (matches(child)) out.push(child);
      out.push(...child.querySelectorAll(selector));
    }
    return out;
  }
}

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => new ElementStub() });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('innerWidth', 1200);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});

afterEach(() => vi.unstubAllGlobals());

describe('ditado ao fechar o painel', () => {
  it('cancela a espera do microfone, libera o áudio tardio e ignora clique duplicado', async () => {
    let grant!: (stream: MediaStream) => void;
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => { grant = resolve; }));
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    let recorderCreated = 0;
    vi.stubGlobal('MediaRecorder', class {
      static isTypeSupported(): boolean { return true; }
      constructor() { recorderCreated++; }
    });
    const onText = vi.fn();
    const button = new DictationButton(onText, vi.fn());
    (button.el as unknown as ElementStub).fire('click');
    (button.el as unknown as ElementStub).fire('click');
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(button.busy).toBe(true);

    button.cancel();
    const stop = vi.fn();
    grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    expect(recorderCreated).toBe(0);
    expect(onText).not.toHaveBeenCalled();
    expect(button.busy).toBe(false);
  });
});

describe('Novo agente com lista de projetos tardia', () => {
  it('seleciona a primeira pasta recebida e a envia ao começar', async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    let sendFolders!: (res: Response) => void;
    vi.stubGlobal('fetch', vi.fn((path: string, init?: RequestInit) => {
      requests.push({ path, init });
      if (path === '/api/spawn/folders') return new Promise<Response>((resolve) => { sendFolders = resolve; });
      return Promise.resolve({ ok: true, json: async () => ({ id: 'x', status: 'failed', error: 'teste' }) } as Response);
    }));
    const panel = new SpawnPanel({ store: { snapshot: null }, announce: () => {} } as never);
    panel.toggle(new ElementStub() as unknown as HTMLElement);
    expect((panel.el as unknown as ElementStub).querySelector('.ui-spawn__path')?.hidden).toBe(false);

    sendFolders({ ok: true, json: async () => ({ folders: [{ path: 'C:\\Projetos\\um', name: 'um', lastAt: 0 }] }) } as Response);
    await vi.waitFor(() => expect((panel.el as unknown as ElementStub).querySelector('.ui-spawn__folder')?.getAttribute('aria-checked')).toBe('true'));
    expect((panel.el as unknown as ElementStub).querySelector('.ui-spawn__path')?.hidden).toBe(true);
    (panel.el as unknown as ElementStub).querySelector('.ui-spawn__go')?.fire('click');
    await vi.waitFor(() => expect(requests.some((r) => r.path === '/api/spawn')).toBe(true));
    const sent = requests.find((r) => r.path === '/api/spawn');
    expect(JSON.parse(String(sent?.init?.body))).toMatchObject({ folder: 'C:\\Projetos\\um' });
  });
});
