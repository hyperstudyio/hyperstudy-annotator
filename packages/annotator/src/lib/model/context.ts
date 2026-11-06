// The open session and its source, shared with every component under the viewer, and how the embedding app opens a
// page outside the annotator.
import { getContext, setContext } from 'svelte';
import type { Session } from './session.svelte';
import type { BundleSource } from '../source';
import { browserOpen, type OpenExternal } from '../links';

const SESSION = Symbol('session'), SOURCE = Symbol('source'), OPEN = Symbol('open');
export const provideSession = (s: Session, source: BundleSource, open: OpenExternal = browserOpen) => {
  setContext(SESSION, s); setContext(SOURCE, source); setContext(OPEN, open);
};
export const useSession = () => getContext<Session>(SESSION);
export const useSource = () => getContext<BundleSource>(SOURCE);
export const useOpenExternal = () => getContext<OpenExternal | undefined>(OPEN) ?? browserOpen;
