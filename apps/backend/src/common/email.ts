import { Transform } from 'class-transformer';

// Security review (Phase 21b): emails are compared and stored in lower case
// everywhere, so "Awa@x.com" and "awa@x.com" are one account.
export const NormalizeEmail = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));
