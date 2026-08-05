import { Module } from '@nestjs/common';
import { OAuthModule } from '../oauth/oauth.module';
import { McpClientService } from './mcp-client.service';

@Module({
  imports: [OAuthModule],
  providers: [McpClientService],
  exports: [McpClientService],
})
export class McpModule {}