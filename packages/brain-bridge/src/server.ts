import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { SdkLettaTurnClient } from './client.ts';
import { loadLettaBrainConfig } from './config.ts';
import { handleBridgeProtocolRequest, MAX_PROTOCOL_BYTES } from './protocol.ts';

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_PROTOCOL_BYTES) throw new Error('payload_too_large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(payload);
}

export async function startBrainBridgeServer(): Promise<void> {
  const token = process.env.PRESTON_BRAIN_BRIDGE_TOKEN ?? '';
  if (token.length < 32) throw new Error('Brain Bridge refuses startup without a strong PRESTON_BRAIN_BRIDGE_TOKEN');

  const config = loadLettaBrainConfig();
  const client = new SdkLettaTurnClient(config);
  const host = process.env.PRESTON_BRAIN_BRIDGE_HOST ?? '127.0.0.1';
  const port = Number.parseInt(process.env.PRESTON_BRAIN_BRIDGE_PORT ?? '8787', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PRESTON_BRAIN_BRIDGE_PORT');

  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://bridge.invalid').pathname;
    let body = '';
    try {
      if (req.method === 'POST') body = await readBody(req);
    } catch {
      writeJson(res, 413, { error: 'payload_too_large' });
      return;
    }

    const result = await handleBridgeProtocolRequest({
      method: req.method ?? 'GET',
      path: pathname,
      authorization: req.headers.authorization,
      body,
    }, client, { token, agentId: config.agentId });
    writeJson(res, result.status, result.body);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  console.log(`Preston Brain Bridge listening on ${host}:${port} (staging-only)`);
}

const direct = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false;
if (direct) {
  startBrainBridgeServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Preston Brain Bridge startup failed: ${message}`);
    process.exitCode = 1;
  });
}
