// Dependency-free role-based-data rules shared by setup-check (pre-restore) and the zod runtime validator.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const reservedRoles = ['anonymous', 'authenticated', 'Function.Invoke', 'processor'];
const isReservedRole = value => reservedRoles.some(role => role.toLowerCase() === value.toLowerCase());
const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);

export function roleBasedProfileProblem(config) {
  if (!isObject(config)) return 'role-based-data.json must be a JSON object.';
  const extra = Object.keys(config).filter(key => !['profile', 'requiredRole', 'readinessPath'].includes(key));
  if (extra.length) return `role-based-data.json has unsupported keys: ${extra.join(', ')}.`;
  if (config.profile !== 'role-based-data') return 'role-based-data.json profile must be "role-based-data".';
  if (typeof config.requiredRole !== 'string' || !/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(config.requiredRole) ||
      isReservedRole(config.requiredRole)) {
    return `role-based-data.json requiredRole must be a dedicated human application role (letters, digits, . _ -), not ${reservedRoles.join('/')}.`;
  }
  if (typeof config.readinessPath !== 'string' || !/^\/api\/[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(config.readinessPath)) {
    return 'role-based-data.json readinessPath must be /api/<Entity>.';
  }
  return undefined;
}

export function roleBasedDabProblem(dab, profile) {
  if (!isObject(dab)) return 'dab/dab-config.json must be a JSON object.';
  if (dab.autoentities !== undefined) return 'dab/dab-config.json must not use autoentities; list each authorized procedure explicitly.';
  const entities = isObject(dab.entities) ? Object.entries(dab.entities) : [];
  if (!entities.length) return 'dab/dab-config.json defines no entities; add your authorized stored-procedure entities.';
  for (const [name, entity] of entities) {
    if (name === 'FileJob') return 'dab/dab-config.json still contains the foundation FileJob entity; replace it with your stored-procedure entities.';
    if (!isObject(entity) || !isObject(entity.source) || entity.source.type !== 'stored-procedure' ||
        typeof entity.source.object !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(entity.source.object)) {
      return `DAB entity ${name} must have a stored-procedure source named schema.procedure.`;
    }
    const rest = entity.rest;
    if (typeof rest !== 'boolean' && !(isObject(rest) && typeof rest.enabled === 'boolean' &&
        (rest.path === undefined || typeof rest.path === 'string') &&
        (rest.methods === undefined || (Array.isArray(rest.methods) && rest.methods.every(m => m === 'get' || m === 'post'))))) {
      return `DAB entity ${name} rest must be a boolean or { enabled, path?, methods?: get|post }.`;
    }
    if (!Array.isArray(entity.permissions) || !entity.permissions.length || !entity.permissions.every(permission =>
      isObject(permission) && permission.role === profile.requiredRole && Array.isArray(permission.actions) &&
      permission.actions.length > 0 && permission.actions.every(action => action === 'execute'))) {
      return `DAB entity ${name} may grant only execute to ${profile.requiredRole}; remove anonymous, processor or other roles.`;
    }
  }
  const ready = entities.some(([name, entity]) => isObject(entity.rest) && entity.rest.enabled &&
    entity.rest.methods?.includes('get') && `/api/${entity.rest.path || name}` === profile.readinessPath);
  if (!ready) return `No DAB entity serves the readiness path ${profile.readinessPath} as an enabled GET procedure (rest.methods ["get"]).`;
  return undefined;
}

const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
const part = name => `(?:\\[${name}\\]|${name}\\b)`;

// Catches a DAB procedure entity with no declaration in the SQL project before SQL startup is approved.
export function roleBasedProcedureProblem(dab, sqlTexts) {
  const code = sqlTexts.map(stripComments).join('\n');
  const missing = Object.values(isObject(dab?.entities) ? dab.entities : {})
    .map(entity => entity?.source?.object).filter(object => typeof object === 'string')
    .filter(object => {
      const [schema, name] = object.split('.');
      return !new RegExp(`CREATE\\s+(?:OR\\s+ALTER\\s+)?PROC(?:EDURE)?\\s+${part(schema)}\\s*\\.\\s*${part(name)}`, 'i').test(code);
    });
  return missing.length ?
    `dab/dab-config.json references procedures not declared in sql/: ${missing.join(', ')}.` : undefined;
}

export async function readSqlSources(root) {
  const texts = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !['obj', 'bin'].includes(entry.name)) await walk(join(directory, entry.name));
      else if (entry.isFile() && entry.name.endsWith('.sql')) texts.push(await readFile(join(directory, entry.name), 'utf8'));
    }
  }
  try { await walk(join(root, 'sql')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return texts;
}
