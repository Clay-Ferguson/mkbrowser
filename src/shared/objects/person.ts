import { readTextFields } from './objectBlock';
import type { ObjectParseResult } from './objectBlock';

/** The `type` value that marks a YAML block as a person. */
export const PERSON_TYPE = 'person';

/** Display name, as listed in the editor's "Insert Object" menu. */
export const PERSON_LABEL = 'Person';

/** Every property a person block may carry (`bd` is the birthday). All are optional text. */
export const PERSON_FIELDS = ['name', 'bd', 'cell_phone', 'other_phone', 'email', 'address', 'notes'] as const;

export type PersonField = (typeof PERSON_FIELDS)[number];

/** A validated person: only the fields that were present and non-blank. */
export type PersonData = Partial<Record<PersonField, string>>;

/**
 * Checks a parsed `type: person` mapping. Every field is optional, but a block with none of
 * them has nothing to show, so it is rejected rather than rendered as an empty card.
 */
export function parsePerson(data: Record<string, unknown>): ObjectParseResult<PersonData> {
  const result = readTextFields(data, PERSON_FIELDS);
  if (!result.ok) return result;
  if (Object.keys(result.value).length === 0) {
    return { ok: false, error: `needs at least one of ${PERSON_FIELDS.join(', ')}` };
  }
  return result;
}
