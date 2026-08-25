import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/automation',
})
export class AutomationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(AutomationGateway.name);

  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    this.logger.log(`Client connected to AutomationGateway: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected from AutomationGateway: ${client.id}`);
  }

  @SubscribeMessage('join_channel')
  handleJoinChannel(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { channelId: string },
  ) {
    if (data?.channelId) {
      const room = `channel:${data.channelId}`;
      client.join(room);
      this.logger.log(`Client ${client.id} joined room ${room}`);
      return { success: true, room };
    }
    return { success: false, error: 'channelId required' };
  }

  @SubscribeMessage('leave_channel')
  handleLeaveChannel(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { channelId: string },
  ) {
    if (data?.channelId) {
      const room = `channel:${data.channelId}`;
      client.leave(room);
      this.logger.log(`Client ${client.id} left room ${room}`);
      return { success: true };
    }
    return { success: false };
  }

  emitBatchStarted(channelId: string, payload: any) {
    if (!this.server) return;
    this.server.to(`channel:${channelId}`).emit('automation:batch_started', payload);
  }

  emitItemProgress(channelId: string, payload: any) {
    if (!this.server) return;
    this.server.to(`channel:${channelId}`).emit('automation:item_progress', payload);
  }

  emitBatchCompleted(channelId: string, payload: any) {
    if (!this.server) return;
    this.server.to(`channel:${channelId}`).emit('automation:batch_completed', payload);
  }

  emitStatsUpdated(channelId: string, payload: any) {
    if (!this.server) return;
    this.server.to(`channel:${channelId}`).emit('automation:stats_updated', payload);
  }
}
