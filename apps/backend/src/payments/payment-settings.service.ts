import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PaymentGateway, PaymentProviderType, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { mockPaymentsAllowed } from './providers/mock.provider';

// Ways to pay (Phase 23, docs/payments.md): which methods buyers see at
// checkout, and whether Wave goes through Modem Pay or straight to Wave.
// Kept in platform_settings under "payments"; Admin → Ways to pay.

export const PAY_METHODS = ['WAVE', 'AFRIMONEY', 'QMONEY', 'CARD', 'BANK_TRANSFER'] as const;
export type PayMethod = (typeof PAY_METHODS)[number];
export type WaveRoute = 'MODEMPAY' | 'DIRECT';

const KEY = 'payments';
const NAMES: Record<PayMethod | 'MOCK', string> = { WAVE: 'Wave', AFRIMONEY: 'Afrimoney', QMONEY: 'QMoney', CARD: 'Card', BANK_TRANSFER: 'Bank transfer', MOCK: 'Test payment' };

interface Stored {
  enabled?: Partial<Record<PayMethod, boolean>>;
  waveRoute?: WaveRoute;
}
type Actor = { id: string; role: UserRole };

export const modemPayConfigured = () => Boolean(process.env.MODEMPAY_SECRET_KEY && process.env.MODEMPAY_WEBHOOK_SECRET);
export const waveDirectConfigured = () => Boolean(process.env.WAVE_API_KEY && process.env.WAVE_WEBHOOK_SECRET);
const modemPayTestMode = () => /^sk_test_/.test(process.env.MODEMPAY_SECRET_KEY ?? '') || process.env.MODEMPAY_TEST_MODE === 'true';

@Injectable()
export class PaymentSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private async stored(): Promise<Required<Stored>> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: KEY } });
    const v = (row?.value ?? {}) as Stored;
    return { enabled: v.enabled ?? {}, waveRoute: v.waveRoute === 'DIRECT' ? 'DIRECT' : 'MODEMPAY' };
  }

  /** Who takes a payment made with this method, right now. */
  async gatewayFor(method: PaymentProviderType): Promise<PaymentGateway> {
    switch (method) {
      case PaymentProviderType.BANK_TRANSFER:
        return PaymentGateway.BANK;
      case PaymentProviderType.MOCK:
        return PaymentGateway.MOCK;
      case PaymentProviderType.WAVE: {
        // Wave direct only when chosen and connected; otherwise Modem Pay.
        const s = await this.stored();
        return s.waveRoute === 'DIRECT' && waveDirectConfigured() ? PaymentGateway.WAVE : PaymentGateway.MODEMPAY;
      }
      default:
        return PaymentGateway.MODEMPAY;
    }
  }

  private connected(gateway: PaymentGateway) {
    if (gateway === PaymentGateway.MODEMPAY) return modemPayConfigured();
    if (gateway === PaymentGateway.WAVE) return waveDirectConfigured();
    return true;
  }

  /** The methods buyers can choose at checkout, in order. */
  async forCheckout() {
    const s = await this.stored();
    const list: { id: PayMethod | 'MOCK'; name: string }[] = [];
    for (const m of PAY_METHODS) {
      if (s.enabled[m] === false) continue;
      if (!this.connected(await this.gatewayFor(m))) continue;
      list.push({ id: m, name: NAMES[m] });
    }
    if (mockPaymentsAllowed()) list.push({ id: 'MOCK', name: NAMES.MOCK });
    return list;
  }

  /** Refuses a method that's switched off or not connected. */
  async ensureAvailable(method: PaymentProviderType) {
    if (method === PaymentProviderType.MOCK || method === PaymentProviderType.PAYPAL) return;
    const s = await this.stored();
    const name = NAMES[method as PayMethod] ?? method;
    if (s.enabled[method as PayMethod] === false || !this.connected(await this.gatewayFor(method))) {
      throw new ServiceUnavailableException(`${name} isn’t available right now. Choose another way to pay.`);
    }
  }

  async adminView() {
    const s = await this.stored();
    const row = await this.prisma.platformSetting.findUnique({ where: { key: KEY }, select: { updatedAt: true } });
    return {
      methods: PAY_METHODS.map((id) => ({ id, name: NAMES[id], enabled: s.enabled[id] !== false, gateway: id === 'BANK_TRANSFER' ? 'BANK' : id === 'WAVE' && s.waveRoute === 'DIRECT' && waveDirectConfigured() ? 'WAVE' : 'MODEMPAY' })),
      waveRoute: s.waveRoute,
      modemPay: { connected: modemPayConfigured(), testMode: modemPayConfigured() && modemPayTestMode() },
      waveDirect: { connected: waveDirectConfigured() },
      updatedAt: row?.updatedAt ?? null,
    };
  }

  private async save(actor: Actor, next: Required<Stored>, action: string, metadata: Prisma.InputJsonValue) {
    await this.prisma.$transaction([
      this.prisma.platformSetting.upsert({
        where: { key: KEY },
        create: { key: KEY, value: next as unknown as Prisma.InputJsonValue, updatedById: actor.id },
        update: { value: next as unknown as Prisma.InputJsonValue, updatedById: actor.id },
      }),
      this.prisma.auditLog.create({ data: { actorId: actor.id, actorRole: actor.role, action, entityType: 'Payments', entityId: 'methods', metadata } }),
    ]);
    return this.adminView();
  }

  async setEnabled(actor: Actor, method: PayMethod, enabled: boolean) {
    const s = await this.stored();
    return this.save(actor, { ...s, enabled: { ...s.enabled, [method]: enabled } }, 'payment_method_switched', { method, enabled });
  }

  async setWaveRoute(actor: Actor, route: WaveRoute) {
    if (route === 'DIRECT' && !waveDirectConfigured()) {
      throw new BadRequestException('Wave direct isn’t connected yet: add the Wave Business keys first (docs/payments.md).');
    }
    const s = await this.stored();
    return this.save(actor, { ...s, waveRoute: route }, 'wave_route_changed', { route });
  }
}
