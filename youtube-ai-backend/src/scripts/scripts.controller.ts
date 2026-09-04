import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ScriptsService } from './scripts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelOwnershipGuard } from '../common/guards/channel-ownership.guard';
import { CreateScriptDto, SaveScriptDto, ScriptQueryDto, BeautifyScriptDto } from './dto/script.dto';

@Controller('channels/:channelId/scripts')
@UseGuards(JwtAuthGuard, ChannelOwnershipGuard)
export class ScriptsController {
  constructor(private readonly scriptsService: ScriptsService) {}

  @Post()
  createScript(
    @Param('channelId') channelId: string,
    @Req() req: any,
    @Body() dto: CreateScriptDto,
  ) {
    const userId = req.user?.userId || req.user?.id || req.user?._id;
    return this.scriptsService.createScript(channelId, userId, dto);
  }

  @Get()
  findAll(
    @Param('channelId') channelId: string,
    @Query() query: ScriptQueryDto,
  ) {
    return this.scriptsService.findAll(channelId, query);
  }

  @Get('stats')
  getStats(@Param('channelId') channelId: string) {
    return this.scriptsService.getStats(channelId);
  }

  @Get('search')
  search(
    @Param('channelId') channelId: string,
    @Query('q') query: string,
    @Query('limit') limit?: number,
  ) {
    return this.scriptsService.hybridSearch(channelId, query, limit ? Number(limit) : 20);
  }

  @Post('beautify')
  beautify(@Body() dto: BeautifyScriptDto) {
    return this.scriptsService.beautifyScript(dto);
  }

  @Get(':id')
  findById(
    @Param('channelId') channelId: string,
    @Param('id') id: string,
  ) {
    return this.scriptsService.findById(channelId, id);
  }

  @Patch(':id')
  saveChanges(
    @Param('channelId') channelId: string,
    @Param('id') id: string,
    @Req() req: any,
    @Body() dto: SaveScriptDto,
  ) {
    const userId = req.user?.userId || req.user?.id || req.user?._id;
    return this.scriptsService.saveChanges(channelId, userId, id, dto);
  }

  @Post(':id/favorite')
  toggleFavorite(
    @Param('channelId') channelId: string,
    @Param('id') id: string,
  ) {
    return this.scriptsService.toggleFavorite(channelId, id);
  }

  @Delete(':id')
  deleteScript(
    @Param('channelId') channelId: string,
    @Param('id') id: string,
  ) {
    return this.scriptsService.deleteScript(channelId, id);
  }

  @Get(':id/versions')
  getVersions(
    @Param('channelId') channelId: string,
    @Param('id') id: string,
  ) {
    return this.scriptsService.getVersions(channelId, id);
  }

  @Post(':id/versions/:versionNumber/restore')
  restoreVersion(
    @Param('channelId') channelId: string,
    @Param('id') id: string,
    @Param('versionNumber') versionNumber: string,
    @Query('expectedVersion') expectedVersion: string,
    @Req() req: any,
  ) {
    const userId = req.user?.userId || req.user?.id || req.user?._id;
    return this.scriptsService.restoreVersion(
      channelId,
      userId,
      id,
      Number(versionNumber),
      expectedVersion !== undefined ? Number(expectedVersion) : undefined,
    );
  }

  @Post(':id/retry-sync')
  retrySync(
    @Param('channelId') channelId: string,
    @Param('id') id: string,
  ) {
    return this.scriptsService.retryVectorSync(channelId, id);
  }
}
