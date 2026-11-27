import { isOutletManager, OUTLET_MANAGER_PARENT } from '../../shared/constants';
import { Hono } from 'hono';
import { getDb } from '../../db';
import * as schema from '../../db/schema';
import { eq, inArray } from 'drizzle-orm';
import { requireAuth, AppContext, EnvBindings } from '../middleware/auth';

const roles = new Hono<{ Bindings: EnvBindings }>();

roles.use('*', requireAuth as any);

roles.get('/', async (c: AppContext) => {
  const db = getDb(c.env.DB);
  const allRoles = await db.select().from(schema.roles);
  const roleIds = allRoles.map(r => r.id);

  const rolePermsMap = new Map<string, Array<{ code: string; name: string }>>();
  if (roleIds.length > 0) {
    const allRolePerms = await db
      .select({
        roleId: schema.rolePermissions.roleId,
        code: schema.permissions.code,
        name: schema.permissions.name,
      })
      .from(schema.rolePermissions)
      .innerJoin(schema.permissions, eq(schema.rolePermissions.permissionId, schema.permissions.id))
      .where(inArray(schema.rolePermissions.roleId, roleIds));

    for (const rp of allRolePerms) {
      const list = rolePermsMap.get(rp.roleId);
      if (list) {
        list.push({ code: rp.code, name: rp.name });
      } else {
        rolePermsMap.set(rp.roleId, [{ code: rp.code, name: rp.name }]);
      }
    }
  }

  // Preserve existing role order, placing both manager roles directly beneath
  // their respective parent roles in the directory and RBAC matrix.
  const orderedRoles = allRoles.filter(r=>!isOutletManager(r.code)).flatMap(r=>[
    r, ...allRoles.filter(child => isOutletManager(child.code) && OUTLET_MANAGER_PARENT[child.code]===r.code),
  ]);
  const rolesWithPerms = orderedRoles.map(r => ({
    parentRoleCode: isOutletManager(r.code) ? OUTLET_MANAGER_PARENT[r.code] : null,
    ...r,
    permissions: rolePermsMap.get(r.id) || [],
  }));

  return c.json({
    success: true,
    data: rolesWithPerms,
    error: null,
  });
});

roles.get('/permissions', async (c: AppContext) => {
  const db = getDb(c.env.DB);
  const allPermissions = await db.select().from(schema.permissions);

  return c.json({
    success: true,
    data: allPermissions,
    error: null,
  });
});

export default roles;
