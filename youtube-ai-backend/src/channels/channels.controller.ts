import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelOwnershipGuard } from '../common/guards/channel-ownership.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  CreateChannelDto,
  UpdateSeoSettingsDto,
  UpdateApiKeysDto,
} from './dto/create-channel.dto';

@Controller('channels')
@UseGuards(JwtAuthGuard)
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Get()
  findAll(@CurrentUser('id') userId: string) {
    return this.channelsService.findAllByUser(userId);
  }

  @UseGuards(ChannelOwnershipGuard)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.channelsService.findById(id);
  }

  @Post()
  create(@CurrentUser('id') userId: string, @Body() dto: CreateChannelDto) {
    return this.channelsService.create(userId, dto);
  }

  @UseGuards(ChannelOwnershipGuard)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateChannelDto,
  ) {
    return this.channelsService.update(id, userId, dto);
  }

  @UseGuards(ChannelOwnershipGuard)
  @Patch(':id/seo-settings')
  updateSeoSettings(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateSeoSettingsDto,
  ) {
    return this.channelsService.updateSeoSettings(id, userId, dto);
  }

  @UseGuards(ChannelOwnershipGuard)
  @Patch(':id/api-keys')
  updateApiKeys(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateApiKeysDto,
  ) {
    return this.channelsService.updateApiKeys(id, userId, dto);
  }

  @UseGuards(ChannelOwnershipGuard)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.channelsService.remove(id, userId);
  }

  @UseGuards(ChannelOwnershipGuard)
  @Post(':id/sync')
  syncChannel(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.channelsService.syncChannel(id, userId);
  }
}
