import './store.css';

// Bantaba, the buyer storefront (Phase 16, docs/storefront.md).
export const metadata = {
  title: 'Bantaba: what’s on in The Gambia',
  description: 'Tickets for concerts, football, comedy and more in The Gambia. Pay with Wave, card or bank transfer.',
};

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return <div className="store">{children}</div>;
}
