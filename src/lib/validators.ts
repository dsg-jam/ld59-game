/**
 * Runtime type validators using Zod to replace "as" casts for network messages.
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Deconstruct Game Messages
// ─────────────────────────────────────────────────────────────────────────────

export const DeconstructRoundStartMsgSchema = z.object({
  type: z.string(),
  grid: z.array(z.array(z.array(z.enum(["R", "G", "B", "Y", "P"])))),
  hand: z.array(
    z.object({
      init: z.number(),
      shape: z.object({
        name: z.string(),
        cells: z.array(z.tuple([z.number(), z.number()])),
      }),
      color: z.enum(["R", "G", "B", "Y", "P"]),
    })
  ),
  turn: z.number(),
  scores: z.array(z.object({ slot: z.number(), score: z.number() })),
  playerCount: z.number(),
  names: z.record(z.number().or(z.string()), z.string()),
  yourSlot: z.number(),
});

export type DeconstructRoundStartMsg = z.infer<typeof DeconstructRoundStartMsgSchema>;

export const DeconstructTurnResultMsgSchema = z.object({
  results: z.array(
    z.object({
      slot: z.number(),
      card: z
        .object({
          init: z.number(),
          shape: z.object({
            name: z.string(),
            cells: z.array(z.tuple([z.number(), z.number()])),
          }),
          color: z.enum(["R", "G", "B", "Y", "P"]),
        })
        .nullable(),
      sel: z.array(z.tuple([z.number(), z.number()])).nullable(),
      points: z.number(),
    })
  ),
  grid: z.array(z.array(z.array(z.enum(["R", "G", "B", "Y", "P"])))),
  scores: z.array(z.object({ slot: z.number(), score: z.number() })),
  turn: z.number(),
  gameOver: z.boolean(),
  winnerSlot: z.number(),
  yourSlot: z.number(),
  names: z.record(z.number().or(z.string()), z.string()),
});

export type DeconstructTurnResultMsg = z.infer<typeof DeconstructTurnResultMsgSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Signal-Cross Game Messages
// ─────────────────────────────────────────────────────────────────────────────

export const SignalCrossNetMsgSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), name: z.string() }),
  z.object({
    type: z.literal("state"),
    snapshot: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("event"),
    event: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("lobby"),
    mode: z.string(),
    supervisorId: z.string().nullable(),
  }),
  z.object({
    type: z.literal("action"),
    action: z.record(z.string(), z.unknown()),
  }),
]);

export type SignalCrossNetMsg = z.infer<typeof SignalCrossNetMsgSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Signal-Surge Game Messages
// ─────────────────────────────────────────────────────────────────────────────

export const SignalSurgeIntentMsgSchema = z.object({
  t: z.literal("intent"),
  lane: z.number().optional(),
  burst: z.boolean().optional(),
});

export type SignalSurgeIntentMsg = z.infer<typeof SignalSurgeIntentMsgSchema>;

export const SignalSurgeHelloJoinMsgSchema = z.object({
  t: z.literal("helloJoin"),
  name: z.string(),
});

export type SignalSurgeHelloJoinMsg = z.infer<typeof SignalSurgeHelloJoinMsgSchema>;

export const SignalSurgeHostMsgSchema = z.union([
  SignalSurgeIntentMsgSchema,
  SignalSurgeHelloJoinMsgSchema,
]);

export type SignalSurgeHostMsg = z.infer<typeof SignalSurgeHostMsgSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Generic Validators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generic validator for messages with a 'type' discriminator field.
 * Used when you want to validate the message has a type field but don't need strict schemas.
 */
export const GenericGameMsgSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

export type GenericGameMsg = z.infer<typeof GenericGameMsgSchema>;

/**
 * Validate unknown data as a specific message type.
 * Returns the validated data or throws a ZodError.
 */
export function validateMessage<T extends z.ZodSchema>(data: unknown, schema: T): z.infer<T> {
  return schema.parse(data);
}

/**
 * Safely validate unknown data without throwing.
 * Returns { success: true, data } or { success: false, error }.
 */
export function safeValidateMessage<T extends z.ZodSchema>(
  data: unknown,
  schema: T
): { success: true; data: z.infer<T> } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Validate that data is an object with a specific type discriminator value.
 * Useful for narrowing union types at runtime.
 */
export function validateMessageType(data: unknown, expectedType: string): data is GenericGameMsg {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  return "type" in data && data.type === expectedType;
}

/**
 * Validate that data is an object with a specific 't' discriminator value.
 * Useful for narrowing union types at runtime (signal-surge style).
 */
export function validateMessageT(data: unknown, expectedT: string): data is { t: string } {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  return "t" in data && data.t === expectedT;
}

/**
 * Extract and validate a property from a message object.
 * Returns the property value if present and matches the schema, otherwise throws.
 */
export function extractMessageProperty<T extends z.ZodSchema>(
  msg: GenericGameMsg,
  key: keyof GenericGameMsg,
  schema: T
): z.infer<T> {
  const value = msg[key];
  return schema.parse(value);
}

/**
 * Extract and validate a property from a message object safely.
 * Returns { success: true, data } or { success: false, error }.
 */
export function safeExtractMessageProperty<T extends z.ZodSchema>(
  msg: GenericGameMsg,
  key: keyof GenericGameMsg,
  schema: T
): { success: true; data: z.infer<T> } | { success: false; error: z.ZodError } {
  const value = msg[key];
  const result = schema.safeParse(value);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Type guard to check if value is an array of [number, number] tuples.
 */
export function isCoordinateTuples(value: unknown): value is Array<[number, number]> {
  if (!Array.isArray(value)) return false;
  return value.every(
    (v): v is [number, number] =>
      Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number"
  );
}

/**
 * Clone an array of [number, number] tuples.
 */
export function cloneTupleArray(tuples: Array<[number, number]>): Array<[number, number]> {
  return tuples.map(([x, y]) => [x, y]);
}

/**
 * Type guard to check if an unknown value is an object with a 't' property.
 */
export function isGameMessage(value: unknown): value is { t: string } {
  if (typeof value !== "object" || value === null) return false;
  if (!("t" in value)) return false;
  const t = value["t"];
  return typeof t === "string";
}

/**
 * Type guard to narrow unknown to an object with a string 'type' property.
 */
export function isTypedMessage(
  value: unknown
): value is Record<string, unknown> & { type: string } {
  if (typeof value !== "object" || value === null) return false;
  if (!("type" in value)) return false;
  const t = value["type"];
  return typeof t === "string";
}
