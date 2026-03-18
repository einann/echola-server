import { Module } from '@nestjs/common';
import { MediaService } from './media.service';
import { MediaHandler } from './media.handler';
import { ImageProcessor, VideoProcessor, AudioProcessor } from './processors';
import { MediaController } from './media.controller';
import { StorageModule } from 'src/storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [MediaController],
  providers: [MediaService, MediaHandler, ImageProcessor, VideoProcessor, AudioProcessor],
  exports: [MediaService, MediaHandler],
})
export class MediaModule {}
