import type { TypeDefinitions } from '../../src/shared/shared';

/**
 * A user-defined `person` type equivalent to the old built-in Person object (same seven
 * properties, same order), for tests that render or validate object blocks. `email` and
 * `address` carry their property types; everything else is plain text.
 */
export const PERSON_DEFS: TypeDefinitions = {
  person: {
    description: 'A contact',
    properties: {
      name: { description: 'Full name', type: 'text' },
      bd: { description: 'Birthday', type: 'text' },
      cell_phone: { description: 'Cell phone', type: 'text' },
      other_phone: { description: 'Other phone', type: 'text' },
      email: { description: 'Email', type: 'email' },
      address: { description: 'Address', type: 'address' },
      notes: { description: 'Notes', type: 'text' },
    },
  },
};
