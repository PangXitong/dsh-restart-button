/**
 * Minimal React surface, types only.
 *
 * React is a platform baseline module: the DSH client module table seeds it
 * (PLATFORM_MODULES), so `react` is externalized — never bundled — and resolves
 * through the bundle factory's `require` at materialization time. Declaring the
 * handful of hooks used here keeps this package free of a react /
 * @types/react dependency, and this file contributes no runtime code.
 *
 * If @types/react is ever added to devDependencies, delete this file: the two
 * declarations cannot coexist.
 */
declare module 'react' {
  /** Opaque renderable value; this package never inspects it. */
  export type ReactNode = unknown;

  /** A stable mutable holder returned by useRef. */
  export interface RefObject<T> {
    current: T | null;
  }

  /** Shallow props accepted by the intrinsic elements used here. */
  export interface DOMProps {
    [key: string]: unknown;
  }

  export function createElement(
    type: unknown,
    props?: DOMProps | null,
    ...children: unknown[]
  ): ReactNode;

  export function useState<T>(
    initial: T | (() => T),
  ): [T, (next: T | ((prev: T) => T)) => void];

  export function useEffect(
    effect: () => void | (() => void),
    deps?: readonly unknown[],
  ): void;

  export function useRef<T>(initial: T | null): RefObject<T>;

  export const Fragment: unknown;
}
