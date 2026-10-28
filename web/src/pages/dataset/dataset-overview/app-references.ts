import { IDatasetReference } from '@/interfaces/database/dataset';
import { appTypeLabelKey } from '@/pages/analytics/app-type';

/**
 * Detail routes of the app kinds that have one. Evaluation sets are listed
 * inside their own module, so a reference to them is shown as plain text
 * instead of a link that would land on a 404.
 */
const APP_ROUTES: Record<string, string> = {
  chat: '/chat',
  search: '/search',
  agent: '/agent',
};

/**
 * Absolute route of the app that holds the reference, or undefined when the
 * kind has no standalone page.
 */
export const appReferenceRoute = (
  reference: IDatasetReference,
): string | undefined => {
  const base = APP_ROUTES[reference.kind];
  return base ? `${base}/${reference.id}` : undefined;
};

/**
 * i18n key naming the app type. Canvas references carry their category
 * (agent / chatflow / workflow / dataflow) so the list can be precise; a canvas
 * created before the category was filled in still counts as an agent.
 */
export const appReferenceTypeKey = (reference: IDatasetReference): string => {
  if (reference.kind === 'agent') {
    return appTypeLabelKey(reference.category || 'agent_canvas');
  }
  return appTypeLabelKey(reference.kind);
};

/**
 * Display name of a reference: some legacy rows were saved without a name, so
 * the id is the only thing left to show.
 */
export const appReferenceName = (reference: IDatasetReference): string =>
  reference.name || reference.id;
