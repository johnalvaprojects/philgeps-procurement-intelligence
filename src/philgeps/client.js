import { delay, log } from '../log.js';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function timeoutMs() {
  return Number(process.env.REQUEST_TIMEOUT_MS || 45000);
}

export function baseUrl() {
  return (process.env.PHILGEPS_BASE_URL || 'https://philgeps.gov.ph').replace(/\/$/, '');
}

export function requestDelayMs() {
  return Number(process.env.REQUEST_DELAY_MS || 1000);
}

export async function get(url, { as = 'text', ajax = false, referer, includeHeaders = false } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const headers = {
        'User-Agent': process.env.USER_AGENT || DEFAULT_USER_AGENT,
        Accept: as === 'text' ? 'text/html,application/xhtml+xml' : '*/*',
        Referer: referer || `${baseUrl()}/`,
      };

      // The notice page loads the document list with jQuery .load().
      // That request asks for the document table alone. A normal page GET
      // returns the site layout without the file links.
      if (ajax) {
        headers['X-Requested-With'] = 'XMLHttpRequest';
      }

      const response = await fetch(url, {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs()),
      });

      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} for ${url}`);
        error.status = response.status;
        throw error;
      }

      if (as === 'buffer') {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (includeHeaders) {
          return {
            bytes,
            contentDisposition: response.headers.get('content-disposition') || '',
            finalUrl: response.url,
          };
        }
        return bytes;
      }

      return response.text();
    } catch (error) {
      lastError = error;
      const retryable = error.status == null || error.status >= 500;
      if (attempt === 1 && retryable) {
        log('WARN', `Request failed, retrying once: ${url}`);
        await delay(requestDelayMs());
        continue;
      }
      break;
    }
  }

  throw lastError;
}
