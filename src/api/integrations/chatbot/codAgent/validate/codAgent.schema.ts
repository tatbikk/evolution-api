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

export const codAgentSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    enabled: { type: 'boolean' },
    description: { type: 'string' },
    systemPrompt: { type: 'string' },
    llmProvider: { type: 'string', enum: ['openai'] },
    llmModel: { type: 'string' },
    merchantName: { type: 'string' },
    triggerType: { type: 'string', enum: ['all', 'keyword', 'none', 'advanced'] },
    triggerOperator: { type: 'string', enum: ['equals', 'contains', 'startsWith', 'endsWith', 'regex'] },
    triggerValue: { type: 'string' },
    expire: { type: 'integer' },
    keywordFinish: { type: 'string' },
    delayMessage: { type: 'integer' },
    unknownMessage: { type: 'string' },
    listeningFromMe: { type: 'boolean' },
    stopBotFromMe: { type: 'boolean' },
    keepOpen: { type: 'boolean' },
    debounceTime: { type: 'integer' },
    ignoreJids: { type: 'array', items: { type: 'string' } },
    splitMessages: { type: 'boolean' },
    timePerChar: { type: 'integer' },
  },
  required: ['enabled', 'triggerType'],
  ...isNotEmpty('enabled', 'triggerType'),
};

export const codAgentStatusSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    remoteJid: { type: 'string' },
    status: { type: 'string', enum: ['opened', 'closed', 'paused', 'delete'] },
  },
  required: ['remoteJid', 'status'],
  ...isNotEmpty('remoteJid', 'status'),
};

export const codAgentSettingSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    expire: { type: 'integer' },
    keywordFinish: { type: 'string' },
    delayMessage: { type: 'integer' },
    unknownMessage: { type: 'string' },
    listeningFromMe: { type: 'boolean' },
    stopBotFromMe: { type: 'boolean' },
    keepOpen: { type: 'boolean' },
    debounceTime: { type: 'integer' },
    ignoreJids: { type: 'array', items: { type: 'string' } },
    codAgentIdFallback: { type: 'string' },
    splitMessages: { type: 'boolean' },
    timePerChar: { type: 'integer' },
  },
  required: [
    'expire',
    'keywordFinish',
    'delayMessage',
    'unknownMessage',
    'listeningFromMe',
    'stopBotFromMe',
    'keepOpen',
    'debounceTime',
    'ignoreJids',
    'splitMessages',
    'timePerChar',
  ],
  ...isNotEmpty(
    'expire',
    'keywordFinish',
    'delayMessage',
    'unknownMessage',
    'listeningFromMe',
    'stopBotFromMe',
    'keepOpen',
    'debounceTime',
    'ignoreJids',
    'splitMessages',
    'timePerChar',
  ),
};

export const codAgentIgnoreJidSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    remoteJid: { type: 'string' },
    action: { type: 'string', enum: ['add', 'remove'] },
  },
  required: ['remoteJid', 'action'],
  ...isNotEmpty('remoteJid', 'action'),
};
