// The bundled model artifact. `npm run mystery:train` writes mystery-model.json and `npm run mystery:evaluate` adds the
// held-out metrics. The JSON is validated before use (PredictiveService); if it is not a valid trained model every
// station shows the "Rule-based risk estimate" instead.
import artifact from './mystery-model.json';

export const BUNDLED_MODEL: unknown = artifact;
