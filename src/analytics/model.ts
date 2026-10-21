// Loads the frozen Raven Vision weights bundled at build time (if trained). Missing → rule-based fallback.
import { isCompatibleModel, type RavenVisionModel } from './ravenVision.ts';

const bundled = import.meta.glob<RavenVisionModel>('./models/raven-vision.json', { eager: true, import: 'default' });
const candidate = Object.values(bundled)[0] ?? null;

export const RAVEN_VISION_MODEL: RavenVisionModel | null = isCompatibleModel(candidate) ? candidate : null;
