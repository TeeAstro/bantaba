import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Public list of event categories — needed by the create-event form
// (Phase 9), which previously had no way to learn category IDs.
@Controller('categories')
export class CategoriesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  findAll() {
    return this.prisma.eventCategory.findMany({ orderBy: [{ position: 'asc' }, { name: 'asc' }] });
  }
}
