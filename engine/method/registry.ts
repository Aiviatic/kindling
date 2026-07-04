import type { MethodProvider } from './provider';
import { bmadProvider } from './bmad-provider';

/** The method used when the config doesn't choose one — BMad stays the recommended default. */
export const DEFAULT_METHOD = 'bmad';

const METHODS: Record<string, MethodProvider> = {
  [bmadProvider.id]: bmadProvider,
};

/** Resolve a method provider by id, falling back to the default for an absent/unknown id. */
export function getMethod(id: string | undefined): MethodProvider {
  return METHODS[id ?? DEFAULT_METHOD] ?? METHODS[DEFAULT_METHOD];
}
