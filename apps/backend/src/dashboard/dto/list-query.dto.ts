import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { OrderStatus, TicketStatus } from '@prisma/client';
import { ApiEnumOptional } from '../../common/api-enum';

class PagedSearchDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 25;
}

export class ListOrdersQueryDto extends PagedSearchDto {
  @ApiEnumOptional(OrderStatus, 'OrderStatus')
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;
}

export class ListTicketsQueryDto extends PagedSearchDto {
  @ApiEnumOptional(TicketStatus, 'TicketStatus')
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;
}
