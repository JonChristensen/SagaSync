type WebhookEvent = {
  asin?: string;
  status?: string;
  body?: string;
};

interface ParsedWebhookPayload {
  asin?: string;
  status?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/\s+/g, '');
}

function extractNotionPropertyValue(input: unknown): string | undefined {
  if (input === null || input === undefined) return undefined;

  if (typeof input === 'string') return input;
  if (typeof input === 'number' || typeof input === 'bigint') return String(input);
  if (typeof input === 'boolean') return input ? 'true' : 'false';

  if (Array.isArray(input)) {
    for (const item of input) {
      const extracted = extractNotionPropertyValue(item);
      if (extracted) return extracted;
    }
    return undefined;
  }

  if (!isObject(input)) return undefined;

  if (typeof input.plain_text === 'string') return input.plain_text;
  if (typeof input.name === 'string') return input.name;
  if (typeof input.content === 'string') return input.content;

  const type = typeof input.type === 'string' ? input.type : undefined;

  if (type === 'rich_text' && Array.isArray(input.rich_text)) {
    return extractNotionPropertyValue(input.rich_text);
  }

  if (type === 'title' && Array.isArray(input.title)) {
    return extractNotionPropertyValue(input.title);
  }

  if (type === 'select' && input.select) {
    return extractNotionPropertyValue(input.select);
  }

  if (type === 'multi_select' && Array.isArray(input.multi_select)) {
    return extractNotionPropertyValue(input.multi_select);
  }

  if (type === 'status' && input.status) {
    return extractNotionPropertyValue(input.status);
  }

  if (type === 'formula' && input.formula) {
    return extractNotionPropertyValue(input.formula);
  }

  if (type === 'number' && typeof input.number === 'number') {
    return String(input.number);
  }

  if (type === 'checkbox' && typeof input.checkbox === 'boolean') {
    return input.checkbox ? 'true' : 'false';
  }

  if (input.text) {
    const extracted = extractNotionPropertyValue(input.text);
    if (extracted) return extracted;
  }

  if (input.rich_text) {
    const extracted = extractNotionPropertyValue(input.rich_text);
    if (extracted) return extracted;
  }

  if (input.title) {
    const extracted = extractNotionPropertyValue(input.title);
    if (extracted) return extracted;
  }

  if (typeof input.string === 'string') return input.string;
  if (typeof input.number === 'number') return String(input.number);
  if (typeof input.boolean === 'boolean') return input.boolean ? 'true' : 'false';

  if (typeof input.value === 'string') return input.value;
  if (typeof input.value === 'number') return String(input.value);

  return undefined;
}

function extractFromProperties(
  props: Record<string, unknown>,
  target: string
): string | undefined {
  const normalizedTarget = normalizeKey(target);

  for (const [key, value] of Object.entries(props)) {
    const normalizedKey = normalizeKey(key);
    if (normalizedKey === normalizedTarget || normalizedKey.endsWith(normalizedTarget)) {
      const extracted = extractNotionPropertyValue(value);
      if (extracted) return extracted;
    }
  }

  return undefined;
}

function parseBody(body?: string): ParsedWebhookPayload {
  if (!body) return {};

  try {
    const parsed = JSON.parse(body) as unknown;
    if (!isObject(parsed)) return {};

    let asin = typeof parsed.asin === 'string' ? parsed.asin : undefined;
    let status = typeof parsed.status === 'string' ? parsed.status : undefined;

    const containers: Array<Record<string, unknown>> = [];
    const visited = new Set<unknown>();
    const queue: unknown[] = [parsed];

    const enqueue = (value: unknown) => {
      if (value && !visited.has(value) && (Array.isArray(value) || isObject(value))) {
        queue.push(value);
      }
    };

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current)) continue;
      visited.add(current);

      if (Array.isArray(current)) {
        for (const item of current) {
          enqueue(item);
        }
        continue;
      }

      if (!isObject(current)) continue;

      if (!asin && typeof (current as { asin?: unknown }).asin === 'string') {
        asin = (current as { asin: string }).asin;
      }

      if (!status && typeof (current as { status?: unknown }).status === 'string') {
        status = (current as { status: string }).status;
      }

      if (isObject((current as { properties?: unknown }).properties)) {
        containers.push((current as { properties: Record<string, unknown> }).properties);
      }

      for (const value of Object.values(current as Record<string, unknown>)) {
        enqueue(value);
      }
    }

    if (!asin || !status) {
      for (const props of containers) {
        if (!asin) asin = extractFromProperties(props, 'asin');
        if (!status) status = extractFromProperties(props, 'status');
        if (asin && status) break;
      }
    }

    return {
      asin: asin?.trim(),
      status: status?.trim()
    };
  } catch {
    return {};
  }
}

export function parseWebhookPayload(event: WebhookEvent): ParsedWebhookPayload {
  const asin = event.asin?.trim();
  const status = event.status?.trim();

  if (!event.body) {
    return {
      asin,
      status
    };
  }

  const parsed = parseBody(event.body);

  return {
    asin: parsed.asin ?? asin,
    status: parsed.status ?? status
  };
}
