import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StorageService } from './storage.service';
import { FileProcessorService } from './file-processor.service';
import { StorageController } from './storage.controller';
import { MessagesModule } from '../messages/messages.module';
import { StorageHandler } from './storage.handler';
import { StorageValidationService } from './storage-validation.service';

@Module({
  imports: [ConfigModule, MessagesModule],
  controllers: [StorageController],
  providers: [
    StorageService,
    StorageHandler,
    StorageValidationService,
    FileProcessorService,
  ],
  exports: [
    StorageService,
    StorageHandler,
    StorageValidationService,
    FileProcessorService,
  ],
})
export class StorageModule {}
