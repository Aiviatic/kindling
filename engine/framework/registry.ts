import type { FrameworkProvider } from './provider';
import { bmadProvider } from './bmad-provider';
import { noneProvider } from './none-provider';
import { openspecProvider } from './openspec-provider';

/** The framework used when the config doesn't choose one — BMad stays the recommended default. */
export const DEFAULT_FRAMEWORK = 'bmad';

const FRAMEWORKS: Record<string, FrameworkProvider> = {
  [bmadProvider.id]: bmadProvider,
  [noneProvider.id]: noneProvider,
  [openspecProvider.id]: openspecProvider,
};

/** Resolve a framework provider by id, falling back to the default for an absent/unknown id. */
export function getFramework(id: string | undefined): FrameworkProvider {
  return FRAMEWORKS[id ?? DEFAULT_FRAMEWORK] ?? FRAMEWORKS[DEFAULT_FRAMEWORK];
}
