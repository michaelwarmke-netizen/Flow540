import { Global, Module } from '@nestjs/common';
import { AGENT_CONFIG, loadAgentConfig } from './agent-config';

/**
 * Global module that exposes the resolved {@link AgentConfig} under the AGENT_CONFIG token.
 * Global so every feature module can inject it without re-importing.
 */
@Global()
@Module({
  providers: [{ provide: AGENT_CONFIG, useFactory: () => loadAgentConfig() }],
  exports: [AGENT_CONFIG],
})
export class AgentConfigModule {}