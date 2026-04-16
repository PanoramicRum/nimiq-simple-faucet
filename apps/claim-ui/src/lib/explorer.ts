// NOTE: nimiq.watch URL shape is for Albatross PoS. If the deployed explorer
// changes path format, update these base URLs.
export function txUrl(network: 'main' | 'test', txId: string): string {
  const base = network === 'main' ? 'https://nimiq.watch' : 'https://test.nimiq.watch';
  return `${base}/#${txId}`;
}
