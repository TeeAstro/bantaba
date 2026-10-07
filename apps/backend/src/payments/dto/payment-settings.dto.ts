import { IsBoolean, IsIn } from 'class-validator';
import { PAY_METHODS, PayMethod, WaveRoute } from '../payment-settings.service';

export class SetPaymentMethodDto {
  @IsIn(PAY_METHODS as unknown as string[])
  method!: PayMethod;

  @IsBoolean()
  enabled!: boolean;
}

export class SetWaveRouteDto {
  /** MODEMPAY: Wave through Modem Pay. DIRECT: straight to Wave (needs WAVE_API_KEY). */
  @IsIn(['MODEMPAY', 'DIRECT'])
  route!: WaveRoute;
}
