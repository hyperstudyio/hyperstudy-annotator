// Licences of a bundle's layers, as the annotator shows them.
import type { BundleSummary, LicenceMode } from './types';

/** The strictest licence among a bundle's layers: what anyone using the whole bundle must keep to. */
const ORDER: LicenceMode[] = ['commercial-ok', 'api-terms', 'needs-review', 'academic-only'];
export const strictest = (b: Pick<BundleSummary, 'layers'>): LicenceMode =>
  Object.values(b.layers).reduce((a, m) => (ORDER.indexOf(m) > ORDER.indexOf(a) ? m : a), 'commercial-ok' as LicenceMode);

/** A licence as people say it. */
export const LICENCE_TEXT: Record<LicenceMode, string> = {
  'commercial-ok': 'Commercial use allowed', 'api-terms': "Under the API provider's terms",
  'needs-review': 'Licence under review', 'academic-only': 'Academic use only',
};
