import {object, PlatformError, validateInbox} from '../platform/domain.ts';

export type CookingRecipePin = {id: string; sourceUrl: string};
export type CookingPersonal = {type: 'cooking'; schemaVersion: 1; recipe: CookingRecipePin | null};
export type CookingFields = {title: string; text: string; occurredOn: string; personal: CookingPersonal};

const fixedRecipeUrl = /^https:\/\/github\.com\/Anduin2017\/HowToCook\/blob\/[0-9a-f]{40}\/dishes\/[a-z0-9_-]+\/(?:[A-Za-z0-9._~-]|%[0-9A-F]{2}|\/)+\.md$/;

export function validateCookingPersonal(input: unknown): CookingPersonal {
  const fields = object(input, ['type', 'schemaVersion', 'recipe']);
  if (fields.type !== 'cooking' || fields.schemaVersion !== 1) {
    throw new PlatformError(400, 'INVALID_COOKING_FIELDS', '需要有效的做饭记录字段。');
  }
  if (fields.recipe === null) return {type: 'cooking', schemaVersion: 1, recipe: null};
  const pin = object(fields.recipe, ['id', 'sourceUrl']);
  if (typeof pin.id !== 'string' || !/^[0-9a-f]{16}$/.test(pin.id) ||
      typeof pin.sourceUrl !== 'string' || pin.sourceUrl.length > 2048 || !fixedRecipeUrl.test(pin.sourceUrl)) {
    throw new PlatformError(400, 'INVALID_COOKING_RECIPE', '请选择有固定来源的菜谱，或不关联菜谱。');
  }
  return {type: 'cooking', schemaVersion: 1, recipe: {id: pin.id, sourceUrl: pin.sourceUrl}};
}

export function normalizeCookingFields(input: unknown): CookingFields {
  const fields = object(input, ['title', 'text', 'occurredOn', 'personal']);
  if (typeof fields.text !== 'string') throw new PlatformError(400, 'INVALID_TEXT', '复盘可以留空，但需要是文字。');
  if (typeof fields.occurredOn !== 'string' || fields.occurredOn.startsWith('0000-')) {
    throw new PlatformError(400, 'INVALID_DATE', '请选择实际做饭日期。');
  }
  const {title, text, occurredOn, personal} = validateInbox({...fields, disposition: 'reference'});
  if (personal?.type !== 'cooking' || !occurredOn) {
    throw new PlatformError(400, 'INVALID_COOKING_FIELDS', '需要有效的做饭记录字段。');
  }
  return {title, text, occurredOn, personal};
}
