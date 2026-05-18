import { JSONSchema7 } from 'json-schema';
import { v4 } from 'uuid';

/**
 * Validation for the COD merchant profile upsert. Every field is optional —
 * the request is a partial update.
 */
export const codMerchantSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    businessName: { type: 'string', maxLength: 120 },
    escalationNumber: { type: 'string', maxLength: 25 },
    confirmationTemplate: { type: 'string', maxLength: 2000 },
    reminderTemplate: { type: 'string', maxLength: 2000 },
    reminderIntervalMinutes: { type: 'integer', minimum: 1 },
    maxReminders: { type: 'integer', minimum: 0 },
    noResponseAfterMinutes: { type: 'integer', minimum: 1 },
  },
};
