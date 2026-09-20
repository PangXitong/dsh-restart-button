/**
 * dsh-restart-button — Client half (runs in the browser, pure DOM injection).
 *
 * DSH exposes slots only for the conversation area (conversation.input.*,
 * conversation.message.*), not for the main toolbar. So, like the
 * dsh-delete-session plugin, we inject our button via the DOM: a
 * MutationObserver watches body for a toolbar-like container, then mounts a
 * power (⏻) button at its right edge. Clicking the button expands a small
 * popover with "关闭" (Close) and "重启" (Restart) actions that POST to the
 * Host routes registered by src/index.ts.
 *
 * No React / react-dom dependency — plain DOM keeps it robust against DSH
 * version drift and React re-renders.
 */

const PLUGIN_ID = 'dsh-restart-button';
const MARK_ATTR = 'data-dsh-restart-button';
const HOST_CLOSE = '/' + PLUGIN_ID + '/close';
const HOST_RESTART = '/' + PLUGIN_ID + '/restart';

/** Power (shutdown) icon: a broken circle with a vertical line through the gap. */
const POWER_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 2v10"/>' +
  '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/>' +
  '</svg>';

/** Close (door/stop) icon. */
const CLOSE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="5" y="5" width="14" height="14" rx="2"/>' +
  '<path d="M9 9l6 6M15 9l-6 6"/>' +
  '</svg>';

/** Restart (circular arrow) icon. */
const RESTART_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>' +
  '<path d="M21 3v5h-5"/>' +
  '</svg>';

function svgDataUri(svg: string): string {
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

/** Build the popover menu element with Close / Restart buttons. */
function buildPopover(onClose: () => void, onRestart: () => void): HTMLElement {
  const popover = document.createElement('div');
  popover.setAttribute(MARK_ATTR, 'popover');
  Object.assign(popover.style, {
    position: 'fixed',
    zIndex: '2147483647',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '6px',
    borderRadius: '10px',
    // Theme-agnostic surface: translucent + blur, currentColor borders.
    background: 'color-mix(in srgb, var(--dsw-alias-bg-elevated, #ffffff) 92%, transparent)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
    boxShadow: '0 8px 28px rgba(0,0,0,0.28)',
    color: 'inherit',
    minWidth: '132px',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    fontSize: '13px',
  } as Partial<CSSStyleDeclaration>);

  const mkButton = (label: string, icon: string, color: string): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute(MARK_ATTR, 'action');
    Object.assign(btn.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '7px 10px',
      borderRadius: '7px',
      border: 'none',
      background: 'transparent',
      color: color,
      cursor: 'pointer',
      fontSize: '13px',
      fontWeight: '500',
      whiteSpace: 'nowrap' as const,
      transition: 'background 0.12s',
      width: '100%',
      textAlign: 'left' as const,
    } as Partial<CSSStyleDeclaration>);
    const img = document.createElement('img');
    img.src = svgDataUri(icon);
    Object.assign(img.style, { width: '15px', height: '15px', flexShrink: '0' });
    img.alt = '';
    const span = document.createElement('span');
    span.textContent = label;
    btn.appendChild(img);
    btn.appendChild(span);
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'color-mix(in srgb, currentColor 12%, transparent)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'transparent';
    });
    return btn;
  };

  const closeBtn = mkButton('关闭', CLOSE_ICON_SVG, '#e5484d');
  const restartBtn = mkButton('重启', RESTART_ICON_SVG, 'inherit');
  closeBtn.dataset.action = 'close';
  restartBtn.dataset.action = 'restart';
  closeBtn.addEventListener('click', onClose);
  restartBtn.addEventListener('click', onRestart);
  popover.appendChild(restartBtn);
  popover.appendChild(closeBtn);
  return popover;
}

/** The toolbar power button (toggle). */
function buildPowerButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute(MARK_ATTR, 'power');
  btn.title = '关闭 / 重启 DeepSeek Harness';
  btn.setAttribute('aria-label', '关闭 / 重启 DeepSeek Harness');
  Object.assign(btn.style, {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    padding: '0',
    borderRadius: '8px',
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    flexShrink: '0',
    transition: 'background 0.12s',
  } as Partial<CSSStyleDeclaration>);
  const img = document.createElement('img');
  img.src = svgDataUri(POWER_ICON_SVG);
  Object.assign(img.style, { width: '18px', height: '18px', display: 'block' });
  img.alt = '';
  btn.appendChild(img);
  btn.addEventListener('mouseenter', () => {
    btn.style.background = 'color-mix(in srgb, currentColor 14%, transparent)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background = 'transparent';
  });
  return btn;
}

/** Find a toolbar-like container in the DSH Web UI (multi-strategy, resilient). */
function findToolbarContainer(): HTMLElement | null {
  const candidates: Array<HTMLElement | null> = [
    document.querySelector<HTMLElement>('[role="toolbar"]'),
    document.querySelector<HTMLElement>('header'),
    // Common DSH / generic app-bar class hints.
    document.querySelector<HTMLElement>('[class*="toolbar" i]'),
    document.querySelector<HTMLElement>('[class*="appbar" i]'),
    document.querySelector<HTMLElement>('[class*="topbar" i]'),
    document.querySelector<HTMLElement>('[class*="header-bar" i]'),
  ];
  for (const c of candidates) {
    if (c) return c;
  }
  return null;
}

/** Mount the power button (and popover logic) into a toolbar container. */
function mountInto(toolbar: HTMLElement): boolean {
  // Idempotency: skip if we (or a sibling we marked) already injected.
  if (toolbar.querySelector('[' + MARK_ATTR + '="power"')) return false;

  const btn = buildPowerButton();
  // Prefer appending to the end (right edge); wrap so it sits on the right.
  const wrap = document.createElement('div');
  wrap.setAttribute(MARK_ATTR, 'wrap');
  Object.assign(wrap.style, {
    display: 'inline-flex',
    alignItems: 'center',
    marginLeft: 'auto',
    flexShrink: '0',
  } as Partial<CSSStyleDeclaration>);
  wrap.appendChild(btn);

  // If the toolbar is a flex row, marginLeft:auto pushes us to the right.
  // Some toolbars are not flex; appending at the end is still fine.
  try {
    toolbar.appendChild(wrap);
  } catch {
    return false;
  }

  let popover: HTMLElement | null = null;

  const closePopover = () => {
    if (popover) {
      popover.remove();
      popover = null;
    }
  };

  const positionPopover = () => {
    if (!popover) return;
    const rect = btn.getBoundingClientRect();
    const pw = popover.offsetWidth;
    const ph = popover.offsetHeight;
    let left = rect.right - pw;
    let top = rect.bottom + 6;
    // Keep on-screen.
    if (left < 8) left = 8;
    if (top + ph > window.innerHeight - 8) {
      // Flip above if no room below.
      top = Math.max(8, rect.top - ph - 6);
    }
    popover.style.left = left + 'px';
    popover.style.top = top + 'px';
  };

  const callHost = async (route: string, onBusy: () => void) => {
    try {
      onBusy();
      await fetch(route, { method: 'POST' });
      // The host process will exit/restart shortly; the browser tab will
      // disconnect and auto-reconnect (DSH WebSocket). If the fetch resolves
      // without the process exiting, the busy state simply persists.
    } catch {
      // fetch rejects when the process exits — that's expected success.
    }
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (popover) {
      closePopover();
      return;
    }
    popover = buildPopover(
      // Close
      async () => {
        if (!popover) return;
        const actionBtn = popover.querySelector<HTMLButtonElement>(
          '[data-action="close"]',
        );
        callHost(HOST_CLOSE, () => {
          if (actionBtn) {
            const span = actionBtn.querySelector('span');
            if (span) span.textContent = '关闭中…';
            actionBtn.style.pointerEvents = 'none';
            actionBtn.style.opacity = '0.6';
          }
        });
      },
      // Restart
      async () => {
        if (!popover) return;
        const actionBtn = popover.querySelector<HTMLButtonElement>(
          '[data-action="restart"]',
        );
        callHost(HOST_RESTART, () => {
          if (actionBtn) {
            const span = actionBtn.querySelector('span');
            if (span) span.textContent = '重启中…';
            actionBtn.style.pointerEvents = 'none';
            actionBtn.style.opacity = '0.6';
          }
        });
      },
    );
    document.body.appendChild(popover);
    requestAnimationFrame(positionPopover);
  });

  // Dismiss on outside click / Escape.
  document.addEventListener(
    'click',
    (e) => {
      if (!popover) return;
      if (popover.contains(e.target as Node) || btn === e.target) return;
      closePopover();
    },
    true,
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePopover();
  });
  window.addEventListener('scroll', positionPopover, true);
  window.addEventListener('resize', positionPopover);

  return true;
}

/** Fallback floating button if no toolbar is found within a grace window. */
function mountFloating(): boolean {
  if (document.querySelector('[' + MARK_ATTR + '="power"')) return false;
  const host = document.createElement('div');
  host.setAttribute(MARK_ATTR, 'floating-host');
  Object.assign(host.style, {
    position: 'fixed',
    top: '12px',
    right: '12px',
    zIndex: '2147483646',
    display: 'inline-flex',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(host);
  // Reuse mountInto so the power button + popover are fully wired.
  mountInto(host);
  // Make the floating button a little larger and give it a visible surface.
  const btn = host.querySelector<HTMLElement>('[' + MARK_ATTR + '="power"]');
  if (btn) {
    Object.assign(btn.style, {
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      background:
        'color-mix(in srgb, var(--dsw-alias-bg-elevated, #ffffff) 92%, transparent)',
      border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
      boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
    });
  }
  return true;
}

function ensureButton(): boolean {
  // Already mounted?
  if (document.querySelector('[' + MARK_ATTR + '="power"')) return true;
  const toolbar = findToolbarContainer();
  if (toolbar) {
    return mountInto(toolbar);
  }
  return false;
}

/** Public exports consumed by the DSH client-modules loader. */
const inject: string[] = [];

function apply(_ctx?: unknown) {
  // Guard against non-browser (SSR / node check) environments.
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  // Try immediately, then observe for the toolbar to appear (DSH is a SPA,
  // the toolbar mounts after the initial render).
  if (ensureButton()) return;

  const observer = new MutationObserver(() => {
    if (ensureButton()) {
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // If no toolbar appears within ~8s, fall back to a floating button so the
  // plugin is still usable on DSH versions whose DOM differs.
  setTimeout(() => {
    if (!document.querySelector('[' + MARK_ATTR + '="power"')) {
      mountFloating();
      observer.disconnect();
    }
  }, 8000);
}

export { apply, inject };
