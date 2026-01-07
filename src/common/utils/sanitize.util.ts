import DOMPurify from 'isomorphic-dompurify';

/**
 * Sanitizes a string by removing all HTML tags and scripts
 * to prevent XSS attacks
 */
export function sanitizeString(value: string | undefined | null): string | undefined | null {
  if (!value || typeof value !== 'string') {
    return value;
  }

  // Strip all HTML tags - only allow plain text
  const sanitized = DOMPurify.sanitize(value, {
    ALLOWED_TAGS: [], // No HTML tags allowed
    ALLOWED_ATTR: [], // No attributes allowed
    KEEP_CONTENT: true, // Keep text content
  });

  // Trim whitespace
  return sanitized.trim();
}

/**
 * Decorator to sanitize string properties in DTOs
 * Usage: @Sanitize() in DTO class properties
 */
export function Sanitize() {
  return function (target: any, propertyKey: string) {
    let value = target[propertyKey];

    const getter = function () {
      return value;
    };

    const setter = function (newVal: any) {
      value = sanitizeString(newVal);
    };

    Object.defineProperty(target, propertyKey, {
      get: getter,
      set: setter,
      enumerable: true,
      configurable: true,
    });
  };
}
