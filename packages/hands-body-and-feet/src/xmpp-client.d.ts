// Type declarations for @xmpp/client (no @types package available)
declare module '@xmpp/client' {
  import type { EventEmitter } from 'events';

  export interface XmppStanza {
    is(tag: string): boolean;
    attrs: Record<string, string | undefined>;
    getChildText(tag: string): string | null;
    getChild(tag: string): XmppStanza | null;
    children: XmppStanza[];
    name: string;
    text(): string;
  }

  export interface XmppClient extends EventEmitter {
    start(): Promise<void>;
    stop(): Promise<void>;
    send(stanza: unknown): Promise<void>;
    on(event: 'stanza', listener: (stanza: XmppStanza) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'online', listener: (address: unknown) => void): this;
    on(event: 'offline', listener: () => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  export interface XmppOptions {
    service: string;
    domain: string;
    resource?: string;
    username?: string;
    password?: string;
  }

  export function client(options: XmppOptions): XmppClient;

  export function xml(
    name: string,
    attrs?: Record<string, string>,
    ...children: unknown[]
  ): unknown;

  export function jid(jidStr: string): unknown;
}
