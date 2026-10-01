import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Prisma enums are plain objects at runtime, which the @nestjs/swagger
// build plugin can't see through — left alone they'd appear in the
// OpenAPI spec as `type: object`. These mark a property as a *named* enum
// (e.g. `UserRole`), so generated Swift/Kotlin/TypeScript clients get a
// real enum type with every allowed value. See docs/api.md.
export const ApiEnum = (values: Record<string, string>, enumName: string, description?: string) =>
  ApiProperty({ enum: values, enumName, description });

export const ApiEnumOptional = (values: Record<string, string>, enumName: string, description?: string) =>
  ApiPropertyOptional({ enum: values, enumName, description });
