import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';

// Multipart text fields arrive as strings; @Type turns them into numbers.
// All four are fractions (0–1) of the image as the browser displays it
// (after the photo's rotation flag is applied). Send all four or none.
export class CropDto {
  /** Left edge of the crop, as a fraction of the image width (0–1) */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1)
  cropX?: number;

  /** Top edge of the crop, as a fraction of the image height (0–1) */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1)
  cropY?: number;

  /** Crop width, as a fraction of the image width (0–1) */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1)
  cropWidth?: number;

  /** Crop height, as a fraction of the image height (0–1) */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1)
  cropHeight?: number;

  /**
   * fill (default): crop to the frame's shape. fit: keep the whole picture
   * and fill the leftover space (no crop fields then).
   */
  @IsOptional() @IsIn(['fill', 'fit'])
  mode?: 'fill' | 'fit';

  /** For mode=fit: blurred copy of the picture (default) or its average colour. */
  @IsOptional() @IsIn(['blur', 'color'])
  background?: 'blur' | 'color';
}
