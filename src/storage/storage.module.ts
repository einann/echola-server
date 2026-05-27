import { DynamicModule, Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { StorageController } from './storage.controller';

@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {
  static forRoot(): DynamicModule {
    const isProduction = process.env.NODE_ENV === 'production';
    return {
      module: StorageModule,
      controllers: isProduction ? [] : [StorageController],
    };
  }
}
