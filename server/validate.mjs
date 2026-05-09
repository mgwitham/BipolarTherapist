const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates a parsed request body against a schema.
 *
 * Schema field rules:
 *   type        — "string" | "email" | "boolean" | "number" | "array"
 *   required    — if true, missing/empty value is an error
 *   maxLength   — max character count (strings)
 *   minLength   — min character count (strings)
 *   max         — max value (numbers)
 *   min         — min value (numbers)
 *   maxItems    — max array length
 *   enum        — array of allowed values (strings)
 *   pattern     — RegExp the trimmed value must match (strings)
 *
 * Returns { ok: true } or { ok: false, field: string, error: string }.
 */
export function validateBody(schema, body) {
  const src = body == null ? {} : body;

  for (const [field, rules] of Object.entries(schema)) {
    const raw = src[field];
    const missing = raw == null || raw === "";

    if (rules.required && missing) {
      return { ok: false, field, error: `${field} is required.` };
    }
    if (missing) continue;

    switch (rules.type) {
      case "string": {
        if (typeof raw !== "string") {
          return { ok: false, field, error: `${field} must be a string.` };
        }
        const val = raw.trim();
        if (rules.minLength && val.length < rules.minLength) {
          return {
            ok: false,
            field,
            error: `${field} must be at least ${rules.minLength} characters.`,
          };
        }
        if (rules.maxLength && val.length > rules.maxLength) {
          return {
            ok: false,
            field,
            error: `${field} must be ${rules.maxLength} characters or fewer.`,
          };
        }
        if (rules.pattern && !rules.pattern.test(val)) {
          return { ok: false, field, error: `${field} format is not valid.` };
        }
        if (rules.enum && !rules.enum.includes(val)) {
          return {
            ok: false,
            field,
            error: `${field} must be one of: ${rules.enum.join(", ")}.`,
          };
        }
        break;
      }
      case "email": {
        if (typeof raw !== "string") {
          return { ok: false, field, error: `${field} must be a string.` };
        }
        const val = raw.trim();
        if (val.length > 254) {
          return { ok: false, field, error: `${field} is too long.` };
        }
        if (!EMAIL_RE.test(val)) {
          return { ok: false, field, error: `${field} must be a valid email address.` };
        }
        break;
      }
      case "boolean": {
        if (typeof raw !== "boolean") {
          return { ok: false, field, error: `${field} must be true or false.` };
        }
        break;
      }
      case "number": {
        if (typeof raw !== "number" || !Number.isFinite(raw)) {
          return { ok: false, field, error: `${field} must be a number.` };
        }
        if (rules.min != null && raw < rules.min) {
          return { ok: false, field, error: `${field} must be at least ${rules.min}.` };
        }
        if (rules.max != null && raw > rules.max) {
          return { ok: false, field, error: `${field} must be at most ${rules.max}.` };
        }
        break;
      }
      case "array": {
        if (!Array.isArray(raw)) {
          return { ok: false, field, error: `${field} must be an array.` };
        }
        if (rules.maxItems != null && raw.length > rules.maxItems) {
          return {
            ok: false,
            field,
            error: `${field} must have at most ${rules.maxItems} items.`,
          };
        }
        break;
      }
    }
  }

  return { ok: true };
}
