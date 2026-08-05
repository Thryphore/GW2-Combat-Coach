export type LogSourceKind = 'dpsreport';

export interface LogSource {
  kind: LogSourceKind;
  /** Log identifier, e.g. "iIoY-20220529-225311_sloth". */
  id: string;
  /** Canonical human-facing URL for the report. */
  permalink: string;
  /** Endpoint returning the Elite Insights JSON. */
  jsonUrl: string;
  /** Display name of the hosting service. */
  serviceName: string;
}

export class LogInputError extends Error {}

const DPS_REPORT_HOSTS = new Set(['dps.report', 'b.dps.report', 'a.dps.report']);
const WINGMAN_HOSTS = new Set(['gw2wingman.nevermindcreations.de', 'wingman.nevermindcreations.de']);

/** dps.report ids look like "iIoY-20220529-225311_sloth"; wingman drops the prefix. */
const BARE_ID = /^[A-Za-z0-9]{0,8}-?\d{8}-\d{6}_[A-Za-z0-9_]+$/;

function dpsReport(id: string, host = 'dps.report'): LogSource {
  const permalink = `https://${host}/${id}`;
  return {
    kind: 'dpsreport',
    id,
    permalink,
    jsonUrl: `https://${host}/getJson?permalink=${encodeURIComponent(permalink)}`,
    serviceName: 'dps.report',
  };
}

/**
 * Accepts a dps.report permalink or a bare log id and resolves the endpoint that
 * serves the Elite Insights JSON for it.
 */
export function parseLogInput(raw: string): LogSource {
  const input = raw.trim();
  if (!input) throw new LogInputError('Paste a dps.report or Wingman log link.');

  if (!/^https?:\/\//i.test(input)) {
    if (BARE_ID.test(input)) return dpsReport(input);
    throw new LogInputError(
      'That does not look like a log link. Expected something like https://dps.report/abcd-20240101-120000_boss',
    );
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new LogInputError('That link could not be parsed as a URL.');
  }

  const host = url.hostname.toLowerCase();

  if (DPS_REPORT_HOSTS.has(host)) {
    // Handles both /<id> and /getJson?permalink=<url> style links.
    const nested = url.searchParams.get('permalink');
    if (nested) return parseLogInput(nested);
    const id = url.pathname.replace(/^\/+|\/+$/g, '');
    if (!id) throw new LogInputError('That dps.report link is missing a report id.');
    return dpsReport(id, host);
  }

  if (WINGMAN_HOSTS.has(host)) {
    // Wingman's getJson endpoint serves the Elite Insights HTML-report schema,
    // which is a different and less detailed shape than the standard EI JSON
    // this app analyzes. Parsing it would silently downgrade the results.
    throw new LogInputError(
      'GW2 Wingman serves a different report format that this app cannot read yet. Paste the dps.report link for the same encounter instead.',
    );
  }

  throw new LogInputError(
    `Unsupported host "${url.hostname}". GW2 Combat Coach reads logs from dps.report.`,
  );
}
