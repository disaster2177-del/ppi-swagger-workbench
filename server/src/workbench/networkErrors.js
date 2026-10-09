/**
 * Turn low-level fetch failures into messages that say what actually went
 * wrong and what to change. Node's fetch reports "fetch failed" with the real
 * reason in err.cause (sometimes nested, or an AggregateError for IPv4+IPv6).
 */
import fs from 'node:fs';

const IN_DOCKER = (() => {
  try {
    return fs.existsSync('/.dockerenv');
  } catch {
    return false;
  }
})();

export function causeCode(err) {
  let e = err;
  for (let i = 0; i < 5 && e; i += 1) {
    if (e.code && typeof e.code === 'string' && e.code !== 'ERR_INVALID_STATE') return e.code;
    if (Array.isArray(e.errors) && e.errors[0]?.code) return e.errors[0].code;
    e = e.cause;
  }
  return err?.name === 'TypeError' ? 'FETCH_FAILED' : 'UNKNOWN';
}

const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|0\.0\.0\.0)$/i;

/** { title, hint } for a failed connection to `url`. */
export function describeNetworkError(code, url) {
  let host = url;
  let port = '';
  try {
    const u = new URL(url);
    host = u.hostname;
    port = u.port || (u.protocol === 'https:' ? '443' : '80');
  } catch {
    /* keep raw */
  }
  const localInDocker = IN_DOCKER && LOCAL.test(host);
  const placeholder = /(^|\.)example\.(com|org|net)$/i.test(host);

  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return {
        title: `The host "${host}" could not be found.`,
        hint: placeholder
          ? `"${host}" is a placeholder domain from the YAML or Settings and has no real server. Set the real Base URL in Settings.`
          : 'Check the Base URL in Settings (or the server in the YAML file), and that the VM can resolve this name (DNS / proxy).',
      };
    case 'ECONNREFUSED':
      return {
        title: `${host}:${port} refused the connection.`,
        hint: localInDocker
          ? `"${host}" means this container, not the VM or your PC. Use the VM's IP address, or host.docker.internal for services on the VM.`
          : 'Nothing is listening on that port. Check the address and that the API is running.',
      };
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
    case 'ENETUNREACH':
    case 'EHOSTUNREACH':
      return {
        title: `Could not connect to ${host}.`,
        hint: 'A firewall or a missing outbound proxy is the usual cause on a VM. Set HTTPS_PROXY / HTTP_PROXY for the app container, or try sending from your browser.',
      };
    case 'ECONNRESET':
    case 'UND_ERR_SOCKET':
      return { title: `${host} closed the connection.`, hint: 'The service or a proxy dropped the request. Try again, or check the service logs.' };
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
    case 'CERT_HAS_EXPIRED':
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return {
        title: `The TLS certificate of ${host} is not trusted.`,
        hint: 'Add your organisation\'s CA certificate to the container with NODE_EXTRA_CA_CERTS (see docs/DEPLOY.md), or fix the certificate.',
      };
    default:
      return { title: `Could not reach ${host}.`, hint: 'Check the Base URL in Settings and that the service is running and reachable from the VM.' };
  }
}
