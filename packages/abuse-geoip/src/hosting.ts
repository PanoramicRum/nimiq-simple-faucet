/**
 * Heuristic detection of datacenter / hosting providers from an ASN org string.
 * Not exhaustive; meant to catch the most common faucet-farming substrates so
 * deployments without a paid anonymous-IP feed still get reasonable coverage.
 * The match is a case-insensitive substring check on the org name.
 */
const HOSTING_KEYWORDS: readonly string[] = [
  'amazon',
  'aws',
  'google cloud',
  'microsoft corporation',
  'azure',
  'digitalocean',
  'linode',
  'vultr',
  'ovh',
  'hetzner',
  'hostinger',
  'contabo',
  'scaleway',
  'oracle cloud',
  'alibaba',
  'tencent',
  'leaseweb',
  'choopa',
  'cogent',
  'packet',
  'equinix',
  'colocrossing',
  'quadranet',
  'hivelocity',
  'hurricane electric',
  'cloudflare',
  'fastly',
  'akamai',
];

const VPN_KEYWORDS: readonly string[] = [
  'nordvpn',
  'expressvpn',
  'mullvad',
  'protonvpn',
  'private internet access',
  'ipvanish',
  'cyberghost',
  'surfshark',
  'tunnelbear',
  'windscribe',
  'hola',
  'hidemyass',
  'tor exit',
];

export function isHostingOrg(org: string | null | undefined): boolean {
  if (!org) return false;
  const lower = org.toLowerCase();
  return HOSTING_KEYWORDS.some((kw) => lower.includes(kw));
}

export function isVpnOrg(org: string | null | undefined): boolean {
  if (!org) return false;
  const lower = org.toLowerCase();
  return VPN_KEYWORDS.some((kw) => lower.includes(kw));
}
