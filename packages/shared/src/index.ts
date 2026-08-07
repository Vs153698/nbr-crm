/**
 * @nbr/shared — the domain kernel.
 *
 * Everything both the API and the web app must agree on lives here: workflow
 * statuses and transitions, the RBAC vocabulary, DPDP compliance terms, money
 * maths, and the Zod schemas that validate each request on both sides of the
 * wire. Importing the same schema in the browser and on the server is what
 * removes the "the form allowed it but the API rejected it" class of bug.
 */

export * from './constants/statuses';
export * from './constants/workflow';
export * from './constants/permissions';
export * from './constants/roles';
export * from './constants/flags';
export * from './constants/catalog';
export * from './constants/templates';
export * from './constants/email-blocks';
export * from './constants/dpdp';
export * from './constants/sales';
export * from './constants/hr';

export * from './schemas/common';
export * from './schemas/auth';
export * from './schemas/applicant';
export * from './schemas/operations';
export * from './schemas/privacy';
export * from './schemas/integration';
export * from './schemas/sales';

export * from './utils/money';
export * from './utils/identity';
export * from './utils/template';
export * from './utils/email-layout';
