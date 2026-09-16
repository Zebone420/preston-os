export type {
  LettaBrainConfig,
  LettaConfigError,
  LettaConfigValidation,
} from './config.js';
export { loadLettaBrainConfig, validateLettaBrainConfig } from './config.js';

export type {
  LettaTurnInput,
  LettaTurnOutput,
  LettaTurnClient,
} from './types.js';

export { SdkLettaTurnClient, buildSystemPrompt } from './client.js';
export {
  handleBridgeProtocolRequest,
  MAX_PROTOCOL_BYTES,
  type BridgeProtocolRequest,
  type BridgeProtocolResponse,
} from './protocol.js';
