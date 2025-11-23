import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StorageService } from './storage.service';
import { FileProcessorService } from './file-processor.service';
import { UploadController } from './upload.controller';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [ConfigModule, MessagesModule],
  controllers: [UploadController],
  providers: [StorageService, FileProcessorService],
  exports: [StorageService, FileProcessorService],
})
export class StorageModule {}
