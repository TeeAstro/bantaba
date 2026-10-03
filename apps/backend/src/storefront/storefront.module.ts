import { Module } from '@nestjs/common';
import { AdminTrendingController, StorefrontController } from './storefront.controller';
import { StorefrontService } from './storefront.service';
import { TrendingService } from './trending.service';
import { SalesCounts } from './cards';

// Phase 16: the Bantaba storefront (docs/storefront.md).
@Module({
  controllers: [StorefrontController, AdminTrendingController],
  providers: [StorefrontService, TrendingService, SalesCounts],
  exports: [SalesCounts],
})
export class StorefrontModule {}
