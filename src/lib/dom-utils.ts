/**
 * Type-safe DOM element access helpers to replace "as" casts.
 */

/**
 * Get a required DOM element by ID with strict type checking.
 * Throws if element is not found or is not of the expected type.
 */
export function getElementStrict<T extends HTMLElement>(
  id: string,
  expectedType: new (...args: never[]) => T
): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Element with id "${id}" not found`);
  }
  if (!(element instanceof expectedType)) {
    throw new Error(`Element with id "${id}" is not an instance of ${expectedType.name}`);
  }
  return element;
}

/**
 * Get a required HTMLElement by ID, safely narrowing it to a specific type.
 * Throws if element is not found or cannot be narrowed to the target type.
 */
export function elementAs<T extends HTMLElement>(
  element: HTMLElement,
  expectedType: new (...args: never[]) => T
): T {
  if (!(element instanceof expectedType)) {
    throw new Error(
      `Element is not an instance of ${expectedType.name}. Got ${element.constructor.name}`
    );
  }
  return element;
}

/**
 * Get an optional DOM element by ID with strict type checking.
 * Returns null if element is not found or is not of the expected type.
 */
export function getElementOptional<T extends HTMLElement>(
  id: string,
  expectedType: new (...args: never[]) => T
): T | null {
  const element = document.getElementById(id);
  if (!element) {
    return null;
  }
  if (!(element instanceof expectedType)) {
    return null;
  }
  return element;
}

/**
 * Type guard for HTMLInputElement.
 */
export function isInputElement(el: EventTarget | null): el is HTMLInputElement {
  return el instanceof HTMLInputElement;
}

/**
 * Type guard for HTMLButtonElement.
 */
export function isButtonElement(el: EventTarget | null): el is HTMLButtonElement {
  return el instanceof HTMLButtonElement;
}

/**
 * Type guard for HTMLSelectElement.
 */
export function isSelectElement(el: EventTarget | null): el is HTMLSelectElement {
  return el instanceof HTMLSelectElement;
}

/**
 * Type guard for HTMLCanvasElement.
 */
export function isCanvasElement(el: EventTarget | null): el is HTMLCanvasElement {
  return el instanceof HTMLCanvasElement;
}

/**
 * Type guard for generic HTMLElement type checking.
 */
export function isHTMLElement<T extends HTMLElement>(
  el: EventTarget | null,
  type: new (...args: never[]) => T
): el is T {
  return el instanceof type;
}

/**
 * Safely narrow a generic event target to a specific element type.
 * Returns the element if it matches, null otherwise.
 */
export function narrowEventTarget<T extends HTMLElement>(
  target: EventTarget | null,
  type: new (...args: never[]) => T
): T | null {
  return target instanceof type ? target : null;
}

/**
 * Convenience helpers for common element retrieval patterns.
 */
export function getInputElement(id: string): HTMLInputElement {
  return getElementStrict(id, HTMLInputElement);
}

export function getButtonElement(id: string): HTMLButtonElement {
  return getElementStrict(id, HTMLButtonElement);
}

export function getCanvasElement(id: string): HTMLCanvasElement {
  return getElementStrict(id, HTMLCanvasElement);
}

export function getSelectElement(id: string): HTMLSelectElement {
  return getElementStrict(id, HTMLSelectElement);
}
