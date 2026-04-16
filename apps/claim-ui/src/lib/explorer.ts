// TODO: confirm explorer URL shape for Albatross — nimiq.watch historically served
// pre-PoS; if the deployed explorer changes, update these two base URLs.
export function txUrl(network: 'main' | 'test', txId: string): string {
  const base = network === 'main' ? 'https://nimiq.watch' : 'https://test.nimiq.watch';
  return `${base}/#${txId}`;
}
