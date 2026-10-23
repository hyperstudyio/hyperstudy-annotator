// The open session and its source, shared with every component under the viewer.
import { getContext, setContext } from 'svelte';
import type { Session } from './session.svelte';
import type { BundleSource } from '../source';

const SESSION = Symbol('session'), SOURCE = Symbol('source');
export const provideSession = (s: Session, source: BundleSource) => { setContext(SESSION, s); setContext(SOURCE, source); };
export const useSession = () => getContext<Session>(SESSION);
export const useSource = () => getContext<BundleSource>(SOURCE);
