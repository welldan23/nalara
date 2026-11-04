// Which IP addresses the worker may connect to (P2-01, PRD v4 §8 SSRF). Default: public unicast
// only. Everything that could reach this machine, the Docker networks, the cloud provider's metadata
// service or another internal host is refused, for IPv4 and IPv6 (including IPv4 embedded in IPv6).
import { BlockList, isIP } from 'node:net';

export interface AddressPolicy {
  /** True when a connection to this address is allowed. */
  readonly allows: (address: string) => boolean;
}

// Two lists: Node's BlockList also matches an IPv4 address against IPv6 rules (as ::ffff:a.b.c.d),
// so the IPv4-mapped rule below would otherwise refuse every IPv4 address.
const blockedV4 = new BlockList();
const blockedV6 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this network"; 0.0.0.0 reaches localhost on Linux
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12], // private (Docker networks live here)
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, incl. broadcast
] as const) {
  blockedV4.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['::ffff:0:0', 96], // IPv4-mapped: would bypass the IPv4 rules
  ['::', 96], // IPv4-compatible (deprecated)
  ['64:ff9b::', 96], // NAT64: could translate to a private IPv4
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard
  ['2001::', 23], // IETF protocol assignments, incl. Teredo 2001::/32
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4: embeds an IPv4 address
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
] as const) {
  blockedV6.addSubnet(network, prefix, 'ipv6');
}

/** Public unicast addresses only. */
export const PUBLIC_ONLY: AddressPolicy = {
  allows: (address) => {
    const family = isIP(address);
    if (family === 0) return false;
    return family === 4 ? !blockedV4.check(address, 'ipv4') : !blockedV6.check(address, 'ipv6');
  },
};

/** Tests only: allow exactly these addresses (everything else still refused). */
export function onlyAddresses(addresses: readonly string[]): AddressPolicy {
  return { allows: (address) => addresses.includes(address) };
}
