const HTTP_METHOD = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/i;
const STANDALONE_METHOD = /^\s*(?:\|\s*)?(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\|?\s*$/i;

function plain(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isHeader(value) {
  return /danh\s*sach\s*api\s*\/\s*web\s*service/.test(plain(value));
}

function isStop(value) {
  const text = plain(value).replace(/^\|\s*/, '');
  return [
    'thong tin ve tai khoan ung dung',
    'app test',
    'du lieu input test',
    'thong tin chi tiet ha tang',
    'mo ta chuc nang moi',
    'mo hinh ket noi',
    'cong nghe su dung cho he thong'
  ].some(label => text.startsWith(label));
}

function cleanText(value) {
  return String(value || '')
    .replace(/\\(?=[:/])/g, '')
    .replace(/\s*\/\s*/g, '/')
    // Mammoth appends a hyperlink target in parentheses after the visible URL.
    .replace(/\s*\(\s*(?:%20|\s)*(?:https?:\/\/|\/)[^)]*\)\s*$/i, '')
    .trim();
}

function endpointTokens(value) {
  const text = cleanText(value);
  const tokens = [];
  const pattern = /https?:\/\/[^\s'"<>\])|,;]+|\/[A-Za-z0-9_.~{}:%-][^\s'"<>\])|,;]*/ig;
  for (const match of text.matchAll(pattern)) {
    let token = match[0].replace(/[|,;]+$/, '');
    let end = match.index + match[0].length;
    // In rows such as "GET https://host/api: mô tả", the colon separates
    // prose from the URL and is not part of the endpoint path.
    if (token.endsWith(':') && /^:\s+\S/u.test(text.slice(end - 1))) { token = token.slice(0, -1); end -= 1; }
    if (token) tokens.push({ token, index: match.index, end });
  }
  return tokens;
}

function parseEndpoint(route, base) {
  route = cleanText(route).replace(/[|,;]+$/, '');
  try {
    if (/^https?:\/\//i.test(route)) {
      const url = new URL(route);
      return { protocol: url.protocol.toLowerCase(), host: url.host.toLowerCase(), path: url.pathname || '/' };
    }
    if (!route.startsWith('/')) return null;
    if (base && /^https?:\/\//i.test(base)) {
      const url = new URL(route, base);
      return { protocol: url.protocol.toLowerCase(), host: url.host.toLowerCase(), path: url.pathname || '/' };
    }
    return { protocol: '', host: '', path: route.split(/[?#]/)[0] };
  } catch {
    return null;
  }
}

function extractApiScope(blocks) {
  const rows = Array.isArray(blocks) ? blocks : [];
  const header = rows.findIndex(row => isHeader(row?.text));
  if (header < 0) return { found: false, endpoints: [], rowIds: new Set(), unparsed: 0 };

  const endpoints = [];
  const rowIds = new Set();
  let base = '';
  let expectBase = false;
  let unparsed = 0;

  const nearbyMethod = index => {
    for (const direction of [1, -1]) {
      for (let offset = 1; offset <= 4; offset++) {
        const candidate = rows[index + direction * offset];
        if (!candidate || isStop(candidate.text)) break;
        const candidateText = cleanText(candidate.text);
        const match = candidateText.match(STANDALONE_METHOD);
        if (match) return match[1].toUpperCase();
        if (/^\s*(?:\|\s*)?-H\b/i.test(candidateText)) continue;
        if (endpointTokens(candidateText).length) break;
      }
    }
    return '';
  };

  for (let index = header + 1; index < rows.length; index++) {
    const row = rows[index];
    let text = cleanText(row?.text);
    if (index > header + 1 && isStop(text)) break;
    if (!text || /^\|+$/.test(text.replace(/\s/g, ''))) continue;

    const normalized = plain(text);
    const labelText = normalized.replace(/\{[^}]*\}/g, '');
    const baseLabel = /(?:url\s*[- ]?\s*base|base\s*url|baseurl|dia chi base|domain base)/i.test(labelText);
    const rawTokens = endpointTokens(text);
    if (baseLabel) {
      const full = rawTokens.find(item => /^https?:\/\//i.test(item.token));
      if (full) base = full.token;
      else expectBase = true;
      continue;
    }
    if (expectBase && rawTokens.length) {
      const full = rawTokens.find(item => /^https?:\/\//i.test(item.token));
      if (full) { base = full.token; expectBase = false; continue; }
      expectBase = false;
    }

    if (/^\s*(?:\|\s*)?-H\b/i.test(text) || /^\s*(?:origin|referer|host)\s*:/i.test(text)) continue;
    const methodMatch = text.match(HTTP_METHOD);
    const standalone = text.match(STANDALONE_METHOD);
    if (standalone && !rawTokens.length) continue;
    const method = methodMatch ? methodMatch[1].toUpperCase() : nearbyMethod(index);

    // A bare origin is a base address, not an endpoint, unless an HTTP method
    // explicitly marks the root path as test scope.
    const tokens = rawTokens.filter(item => {
      if (method) return true;
      if (!/^https?:\/\//i.test(item.token)) return true;
      try {
        const url = new URL(item.token);
        if ((url.pathname === '/' || !url.pathname) && !url.search) { base = item.token; return false; }
      } catch {}
      return true;
    });

    if (!tokens.length) {
      if (methodMatch && !standalone) unparsed += 1;
      continue;
    }

    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
      const item = tokens[tokenIndex];
      const parsed = parseEndpoint(item.token, base);
      if (!parsed || !parsed.path.startsWith('/') || /\s/.test(parsed.path)) { unparsed += 1; continue; }
      const after = tokenIndex === tokens.length - 1 ? text.slice(item.end) : '';
      const description = after.replace(/^\s*(?:[-–—:|]|\)|\])+\s*/u, '').trim();
      endpoints.push({
        method,
        ...parsed,
        description,
        evidence: [{ sourceId: row.id, quote: String(row.text || '').trim() }]
      });
      rowIds.add(row.id);
    }
  }

  const unique = [...new Map(endpoints.map(endpoint => [
    JSON.stringify([endpoint.method, endpoint.protocol, endpoint.host, endpoint.path]), endpoint
  ])).values()];
  return { found: unique.length > 0, endpoints: unique, rowIds, unparsed };
}

module.exports = { extractApiScope, cleanText, endpointTokens, parseEndpoint };
