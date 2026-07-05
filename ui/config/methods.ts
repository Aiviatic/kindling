// UI presentation list for the project-method picker. Kept separate from the engine registry
// (engine/method/registry.ts) because that pulls node-only code into the browser bundle; the ids
// here must match the engine's provider ids. See docs/install-architecture-design.md.
export interface MethodOption {
  id: string;
  name: string;
  description: string;
  recommended: boolean;
}

export const DEFAULT_METHOD = 'bmad';

export const METHOD_OPTIONS: MethodOption[] = [
  {
    id: 'bmad',
    name: 'BMad Method',
    description: 'A guided workflow that takes your AI from an idea to a working app.',
    recommended: true,
  },
  {
    id: 'none',
    name: 'No framework',
    description: 'Just a clean project and your tools. Bring your own workflow.',
    recommended: false,
  },
];
