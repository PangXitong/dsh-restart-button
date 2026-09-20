/**
 * dsh-restart-button — Client half (runs in the browser).
 *
 * Registers a power (⏻) control into DSH's session-header utilities list
 * (`conversation.session.header.utilities`), the right-aligned row of the
 * conversation header that also carries the host's own "Session log" capsule.
 * Clicking it opens a small menu with 关闭 (Close) and 重启 (Restart), which
 * POST to the same-origin routes registered by src/index.ts in the Host half.
 *
 * Why a slot instead of DOM injection: DSH exposes no toolbar slot, and the
 * header is React-owned — a MutationObserver-injected node is subject to
 * re-render reordering and cannot match the row's own layout. The utilities
 * list is a declared `kind: 'list'` seat, so an entry joins the flow in order
 * and never overlaps host chrome.
 *
 * `slots.inject` (rather than a bare register) is required because the seat's
 * declaration belongs to the ui-conversation entry, which may activate after
 * this plugin; the callback re-runs if the declaration collapses and is
 * re-declared.
 */
import { createElement, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

const PLUGIN_ID = 'dsh-restart-button';
const SLOT_HEADER_UTILITIES = 'conversation.session.header.utilities';
const HOST_CLOSE = '/' + PLUGIN_ID + '/close';
const HOST_RESTART = '/' + PLUGIN_ID + '/restart';

/**
 * Cordis services required before this plugin activates. `slots` is the client
 * slot ledger; nothing else is needed — the button talks to the Host over
 * same-origin `fetch`, not through a client service.
 */
export const inject: string[] = ['slots'];

/** Registration metadata accepted by the client slot ledger. */
interface SlotRegistration {
  name: string;
  id: string;
  order: number;
  registrant: string;
}

/** The slice of the client `slots` service this plugin touches. */
interface SlotsService {
  inject(name: string, callback: () => (() => void) | void): (() => void) | void;
  register(meta: SlotRegistration, render: () => ReactNode): () => void;
}

/** The slice of the client cordis context this plugin touches. */
interface ClientContext {
  slots: SlotsService;
  effect(callback: () => (() => void) | void, label?: string): void;
}

/** Power (shutdown) icon: a broken circle with a vertical line through the gap. */
function PowerIcon(): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2v10" />
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
    </svg>
  );
}

/** Close icon: a framed cross. */
function CloseIcon(): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </svg>
  );
}

/** Restart icon: a circular arrow. */
function RestartIcon(): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

/** One row inside the open menu. */
function MenuRow(props: {
  label: string;
  icon: ReactNode;
  color: string;
  disabled: boolean;
  onClick: () => void;
}): ReactNode {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: '7px 10px',
        border: 'none',
        borderRadius: '7px',
        background: hover && !props.disabled ? 'color-mix(in srgb, currentColor 12%, transparent)' : 'transparent',
        color: props.color,
        cursor: props.disabled ? 'default' : 'pointer',
        opacity: props.disabled ? 0.6 : 1,
        font: 'inherit',
        fontSize: '13px',
        fontWeight: 500,
        textAlign: 'left',
        whiteSpace: 'nowrap',
        transition: 'background 0.12s',
      }}
    >
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}

/**
 * The header control: a power button that toggles a Close / Restart menu.
 *
 * Busy state is terminal on purpose — the Host exits shortly after replying, so
 * the tab disconnects and reconnects on its own; re-enabling the control would
 * only invite a second request against a dying process.
 */
function PowerMenu(): ReactNode {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'close' | 'restart' | null>(null);
  const [hover, setHover] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  // Dismiss the menu on an outside press or Escape, mirroring DSH's own popovers.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const send = (route: string, kind: 'close' | 'restart') => {
    if (busy) return;
    setBusy(kind);
    // The Host replies, then exits ~300ms later. A rejected fetch means the
    // process went away before the body arrived — the expected success path —
    // so the rejection is deliberately swallowed.
    void fetch(route, { method: 'POST' }).catch(() => undefined);
  };

  const title = '关闭 / 重启 DeepSeek Harness';

  return (
    <span ref={rootRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        type="button"
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '30px',
          height: '30px',
          padding: 0,
          border: 'none',
          borderRadius: '8px',
          background: open || hover ? 'color-mix(in srgb, currentColor 12%, transparent)' : 'transparent',
          color: 'inherit',
          cursor: 'pointer',
          flexShrink: 0,
          transition: 'background 0.12s',
        }}
      >
        <PowerIcon />
      </button>

      {open ? (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 2147483000,
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            minWidth: '136px',
            padding: '6px',
            border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
            borderRadius: '10px',
            background: 'var(--dsw-alias-bg-elevated, #ffffff)',
            boxShadow: '0 8px 28px rgba(0, 0, 0, 0.28)',
            color: 'inherit',
            fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          }}
        >
          <MenuRow
            label={busy === 'restart' ? '重启中…' : '重启'}
            icon={<RestartIcon />}
            color="inherit"
            disabled={busy !== null}
            onClick={() => send(HOST_RESTART, 'restart')}
          />
          <MenuRow
            label={busy === 'close' ? '关闭中…' : '关闭'}
            icon={<CloseIcon />}
            color="#e5484d"
            disabled={busy !== null}
            onClick={() => send(HOST_CLOSE, 'close')}
          />
        </div>
      ) : null}
    </span>
  );
}

/**
 * Client plugin body.
 * @param ctx - the client cordis context (slots, effect).
 */
export function apply(ctx: ClientContext): void {
  // `slots.inject` waits for the seat's declaration and re-runs the callback if
  // it collapses and is re-declared; `effect` disposes the registration when
  // this plugin's fiber goes away (HMR, disable), so re-activation is clean.
  ctx.effect(
    () =>
      ctx.slots.inject(SLOT_HEADER_UTILITIES, () =>
        ctx.slots.register(
          {
            name: SLOT_HEADER_UTILITIES,
            id: PLUGIN_ID + ':power',
            order: 10,
            registrant: PLUGIN_ID,
          },
          () => <PowerMenu />,
        ),
      ),
    PLUGIN_ID + ': header power menu',
  );
}
