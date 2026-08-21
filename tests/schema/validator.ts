/**
 * A small JSON Schema (draft 2020-12) validator, supporting exactly the
 * keywords `schema/*.schema.json` uses.
 *
 * Why not a library: the repo's only JSON-Schema-capable package is a
 * transitive draft-07 copy of ajv that nothing declares, and adding a
 * dependency to validate four hand-written files is a worse trade than 120
 * lines with its own negative tests. `format.test.ts` exercises the validator
 * against known-bad documents as well as the shipped ones, so a validator that
 * silently accepts everything fails the suite.
 *
 * Supported: $ref (local pointers), type (incl. arrays and `integer`), enum,
 * const, properties, required, additionalProperties, propertyNames, items,
 * minItems, minLength, minimum, maximum, exclusiveMinimum, pattern, oneOf,
 * anyOf, allOf, not, if/then/else. Anything else in a schema is ignored, so
 * keep the schema files inside this set.
 */

type Schema = Record<string, unknown> | boolean;

function typeMatches(value: unknown, type: string): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    default:
      throw new Error(`validator: unsupported type "${type}"`);
  }
}

function resolveRef(root: Schema, ref: string): Schema {
  if (!ref.startsWith("#/") && ref !== "#") throw new Error(`validator: unsupported $ref "${ref}"`);
  let node: unknown = root;
  for (const raw of ref.slice(2).split("/").filter(Boolean)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    node = (node as Record<string, unknown>)[key];
    if (node === undefined) throw new Error(`validator: $ref "${ref}" does not resolve`);
  }
  return node as Schema;
}

/** Returns a list of human-readable errors; empty means valid. */
export function validate(schema: Schema, data: unknown, root: Schema = schema, path = "$"): string[] {
  if (typeof schema === "boolean") return schema ? [] : [`${path}: schema is false`];
  const errors: string[] = [];
  const fail = (msg: string) => errors.push(`${path}: ${msg}`);

  if (typeof schema.$ref === "string") {
    return validate(resolveRef(root, schema.$ref), data, root, path);
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
    if (!types.some((t) => typeMatches(data, t))) fail(`expected type ${types.join(" | ")}, got ${data === null ? "null" : Array.isArray(data) ? "array" : typeof data}`);
  }
  if (schema.const !== undefined && data !== schema.const) fail(`expected const ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.some((v) => v === data)) fail(`expected one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(data)}`);

  if (typeof data === "string") {
    if (typeof schema.minLength === "number" && data.length < schema.minLength) fail(`shorter than minLength ${schema.minLength}`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(data)) fail(`does not match ${schema.pattern}`);
  }
  if (typeof data === "number") {
    if (typeof schema.minimum === "number" && data < schema.minimum) fail(`below minimum ${schema.minimum}`);
    if (typeof schema.maximum === "number" && data > schema.maximum) fail(`above maximum ${schema.maximum}`);
    if (typeof schema.exclusiveMinimum === "number" && data <= schema.exclusiveMinimum) fail(`not above exclusiveMinimum ${schema.exclusiveMinimum}`);
  }
  if (Array.isArray(data)) {
    if (typeof schema.minItems === "number" && data.length < schema.minItems) fail(`fewer than minItems ${schema.minItems}`);
    if (schema.items !== undefined) {
      data.forEach((item, i) => errors.push(...validate(schema.items as Schema, item, root, `${path}[${i}]`)));
    }
  }
  if (typeMatches(data, "object")) {
    const obj = data as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, Schema>;
    for (const key of (schema.required ?? []) as string[]) {
      if (!(key in obj)) fail(`missing required property "${key}"`);
    }
    for (const [key, value] of Object.entries(obj)) {
      if (schema.propertyNames !== undefined) {
        errors.push(...validate(schema.propertyNames as Schema, key, root, `${path}/propertyName(${key})`));
      }
      if (key in props) {
        errors.push(...validate(props[key]!, value, root, `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        fail(`unexpected property "${key}"`);
      } else if (schema.additionalProperties !== undefined) {
        errors.push(...validate(schema.additionalProperties as Schema, value, root, `${path}.${key}`));
      }
    }
  }

  if (Array.isArray(schema.oneOf)) {
    const matched = (schema.oneOf as Schema[]).filter((s) => validate(s, data, root, path).length === 0);
    if (matched.length !== 1) fail(`matched ${matched.length} of ${(schema.oneOf as Schema[]).length} oneOf branches, expected exactly 1`);
  }
  if (Array.isArray(schema.anyOf) && !(schema.anyOf as Schema[]).some((s) => validate(s, data, root, path).length === 0)) {
    fail(`matched no anyOf branch`);
  }
  if (Array.isArray(schema.allOf)) {
    for (const s of schema.allOf as Schema[]) errors.push(...validate(s, data, root, path));
  }
  if (schema.not !== undefined && validate(schema.not as Schema, data, root, path).length === 0) {
    fail(`matched a schema it must not match`);
  }
  if (schema.if !== undefined) {
    const branch = validate(schema.if as Schema, data, root, path).length === 0 ? schema.then : schema.else;
    if (branch !== undefined) errors.push(...validate(branch as Schema, data, root, path));
  }

  return errors;
}
