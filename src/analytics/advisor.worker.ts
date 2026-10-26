// Runs the Monte Carlo strategist off the main thread so the 3D scene and HUD never stall.
import { adviseEgg, adviseRoute } from './advisor.ts';
import type { AdviceRequest, AdviceResponse } from './adviceClient.ts';

self.onmessage = (event: MessageEvent<AdviceRequest>) => {
  const { id, kind, state, view, options } = event.data;
  let response: AdviceResponse;
  try {
    const advice = kind === 'route' ? adviseRoute(state, view, options) : adviseEgg(state, view, options);
    response = { id, ok: true, advice };
  } catch (error) {
    response = { id, ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  (self as unknown as Worker).postMessage(response);
};
