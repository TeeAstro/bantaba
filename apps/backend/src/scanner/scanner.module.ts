import { Module } from '@nestjs/common';
import { ScannerController } from './scanner.controller';
import { ScannerService } from './scanner.service';

@Module({
  controllers: [ScannerController],
  providers: [ScannerService],
})
export class ScannerModule {}
