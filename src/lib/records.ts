/**
 * Untrusted keys (issue ids, labels, assignees) must not collide with
 * `Object.prototype` entries such as `constructor` or `__proto__`: a plain
 * `{}` makes `map['constructor']` inherit a function and `map['__proto__']`
 * write through the prototype setter.
 */
export function emptyRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}
