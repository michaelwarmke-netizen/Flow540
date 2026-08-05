import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import type { AgentConfig } from '../config/agent-config.ts';
import { loadAgentConfig } from '../config/agent-config.ts';
import { Logger } from '../../logger.ts';
import { TokenService } from './token.service.ts';

/**
 * Embedded HTTP server listening on `http://localhost:<port>` (default 3540).
 * Handles `/login` redirects and receives the `/oauth/callback` code exchange.
 */
export class OAuthCallbackServer {
  private readonly logger = new Logger(OAuthCallbackServer.name);
  private server: Server | null = null;
  private readonly config: AgentConfig;
  private readonly tokens: TokenService;
  private onAuthenticatedCallback?: () => void;

  constructor(
    config: AgentConfig = loadAgentConfig(),
    tokens: TokenService = new TokenService(config),
  ) {
    this.config = config;
    this.tokens = tokens;
  }

  start(onAuthenticated?: () => void): void {
    if (this.server) return;
    this.onAuthenticatedCallback = onAuthenticated;

    const port = this.config.port || 3540;

    this.server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const reqUrl = new URL(req.url || '/', `http://localhost:${port}`);
      const pathname = reqUrl.pathname;

      if (pathname === '/login' || pathname === '/oauth/login') {
        try {
          const { url } = await this.tokens.buildAuthorizeUrl();
          res.writeHead(302, { Location: url });
          res.end();
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`<h1>Login Configuration Error</h1><p>${err?.message || err}</p>`);
        }
        return;
      }

      if (pathname === '/oauth/callback' || pathname === '/callback') {
        const code = reqUrl.searchParams.get('code');
        const state = reqUrl.searchParams.get('state');

        if (!code || !state) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Missing OAuth Parameters</h1><p>Expected <code>code</code> and <code>state</code> query parameters.</p>');
          return;
        }

        try {
          await this.tokens.handleCallback(code, state);
          this.onAuthenticatedCallback?.();
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>Authorization Successful</title>
                <style>
                  body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #f8fafc; }
                  .card { background: #1e293b; padding: 2.5rem; border-radius: 1rem; border: 1px solid #334155; text-align: center; max-width: 440px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); }
                  h1 { color: #10b981; font-size: 1.5rem; margin-top: 0; }
                  p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
                </style>
              </head>
              <body>
                <div class="card">
                  <h1>✓ Authorization Successful</h1>
                  <p>OpenWhispr Agent has successfully authorized with your Nexus Sandbox environment.</p>
                  <p>You can close this browser tab and return to the application.</p>
                </div>
              </body>
            </html>
          `);
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`<h1>Authentication Error</h1><p>${err?.message || err}</p>`);
        }
        return;
      }

      // Default status response
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'openwhispr-agent-oauth' }));
    });

    this.server.listen(port, () => {
      this.logger.info(`OAuth callback server listening on http://localhost:${port}`);
    }).on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        this.logger.warn(`Port ${port} is in use; OAuth callback server will defer to active process.`);
      } else {
        this.logger.error(`OAuth callback server error: ${String(err)}`);
      }
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
