import { JSONSchema7 } from 'json-schema';
import { v4 } from 'uuid';

const isNotEmpty = (...propertyNames: string[]): JSONSchema7 => {
  const properties = {};
  propertyNames.forEach(
    (property) =>
      (properties[property] = {
        minLength: 1,
        description: `The "${property}" cannot be empty`,
      }),
  );
  return {
    if: {
      propertyNames: {
        enum: [...propertyNames],
      },
    },
    then: { properties },
  };
};

export const codOrderSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    merchantOrderRef: { type: 'string', maxLength: 120 },
    customerNumber: { type: 'string', maxLength: 25 },
    customerName: { type: 'string', maxLength: 120 },
    totalAmount: { type: 'number', minimum: 0 },
    currency: { type: 'string', maxLength: 8 },
    deliveryAddress: { type: 'string', maxLength: 500 },
    deliveryDate: { type: 'string', maxLength: 40 },
    notes: { type: 'string', maxLength: 1000 },
    items: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        properties: {
          productName: { type: 'string', maxLength: 200 },
          quantity: { type: 'integer', minimum: 1 },
          unitPrice: { type: 'number', minimum: 0 },
        },
        required: ['productName'],
      },
    },
  },
  required: ['merchantOrderRef', 'customerNumber'],
  ...isNotEmpty('merchantOrderRef', 'customerNumber'),
};
