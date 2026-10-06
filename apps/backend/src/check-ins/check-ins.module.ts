import { Module } from '@nestjs/common';
import { CheckInsController } from './check-ins.controller';
import { CheckInsService } from './check-ins.service';
import { OfflineScanService } from './offline.service';

@Module({
  controllers: [CheckInsController],
  providers: [CheckInsService, OfflineScanService],
})
export class CheckInsModule {}
